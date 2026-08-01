import { Redis as UpstashRedis } from '@upstash/redis';
import { createClient, RedisClientType } from 'redis';

import { pruneExpiredMapValues, setBoundedMapValue } from './bounded-map';
import { logger } from './logger';
import { getServerStorageType } from './storage-runtime';

const storageType = getServerStorageType();

let redisClientPromise: Promise<RedisClientType> | null = null;
let upstashClient: UpstashRedis | null = null;
const memoryVersions = new Map<string, number>();
const memoryLimits = new Map<string, { count: number; expiresAt: number }>();
const MAX_MEMORY_LIMIT_ENTRIES = 5000;
const REVOKE_SESSION_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], 2)
  return 2
end
return redis.call('INCR', KEYS[1])
`;
const CONSUME_RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

function getRedisUrl(): string | null {
  return storageType === 'kvrocks'
    ? process.env.KVROCKS_URL || null
    : process.env.REDIS_URL || null;
}

async function getRedisClient(): Promise<RedisClientType | null> {
  const url = getRedisUrl();
  if (!url || !['redis', 'kvrocks'].includes(storageType)) return null;
  if (!redisClientPromise) {
    const client = createClient({ url }) as RedisClientType;
    client.on('error', (error) => {
      logger.error('Security Redis client error:', error);
    });
    redisClientPromise = client
      .connect()
      .then(() => client)
      .catch((error) => {
        redisClientPromise = null;
        throw error;
      });
  }
  return redisClientPromise;
}

function getUpstashClient(): UpstashRedis | null {
  if (storageType !== 'upstash') return null;
  if (!process.env.UPSTASH_URL || !process.env.UPSTASH_TOKEN) return null;
  upstashClient ||= new UpstashRedis({
    url: process.env.UPSTASH_URL,
    token: process.env.UPSTASH_TOKEN,
  });
  return upstashClient;
}

function versionKey(username: string): string {
  return `security:session-version:${username}`;
}

export async function getSessionVersion(username: string): Promise<number> {
  const key = versionKey(username);
  const upstash = getUpstashClient();
  if (upstash) {
    const value = Number(await upstash.get<number>(key));
    if (Number.isInteger(value) && value > 0) return value;
    await upstash.set(key, 1, { nx: true });
    return 1;
  }
  const redis = await getRedisClient();
  if (redis) {
    const value = Number(await redis.get(key));
    if (Number.isInteger(value) && value > 0) return value;
    await redis.set(key, '1', { NX: true });
    return 1;
  }
  return memoryVersions.get(username) || 1;
}

export async function revokeUserSessions(username: string): Promise<number> {
  const key = versionKey(username);
  const upstash = getUpstashClient();
  if (upstash) {
    return Number(await upstash.eval(REVOKE_SESSION_SCRIPT, [key], []));
  }
  const redis = await getRedisClient();
  if (redis) {
    return Number(
      await redis.eval(REVOKE_SESSION_SCRIPT, { keys: [key], arguments: [] })
    );
  }
  const next = (memoryVersions.get(username) || 1) + 1;
  memoryVersions.set(username, next);
  return next;
}

function rateLimitKey(namespace: string, identity: string): string {
  return `security:${namespace}:${identity}`;
}

/**
 * 通用計數式限流：在 windowSeconds 內累計 identity 的次數，超過 limit 即 blocked。
 *
 * 與登入限流共用同一套 Redis / Kvrocks / Upstash / 記憶體後備，namespace 只是
 * key 前綴——`login` 保留給既有的登入鎖定，其餘呼叫端請用自己的 namespace，
 * 避免不同用途互相消耗同一個計數器。
 */
export async function consumeRateLimit(
  namespace: string,
  identity: string,
  limit: number,
  windowSeconds: number
): Promise<{ blocked: boolean; retryAfter: number }> {
  const key = rateLimitKey(namespace, identity);
  const upstash = getUpstashClient();
  if (upstash) {
    const [rawCount, rawTtl] = (await upstash.eval(
      CONSUME_RATE_LIMIT_SCRIPT,
      [key],
      [String(windowSeconds)]
    )) as [number, number];
    const count = Number(rawCount);
    const ttl = Math.max(1, Number(rawTtl));
    return { blocked: count > limit, retryAfter: ttl };
  }
  const redis = await getRedisClient();
  if (redis) {
    const [rawCount, rawTtl] = (await redis.eval(CONSUME_RATE_LIMIT_SCRIPT, {
      keys: [key],
      arguments: [String(windowSeconds)],
    })) as [number, number];
    const count = Number(rawCount);
    const ttl = Math.max(1, Number(rawTtl));
    return { blocked: count > limit, retryAfter: ttl };
  }

  const now = Date.now();
  pruneExpiredMapValues(memoryLimits, (value) => value.expiresAt, now);
  const existing = memoryLimits.get(key);
  const entry =
    existing && existing.expiresAt > now
      ? existing
      : { count: 0, expiresAt: now + windowSeconds * 1000 };
  entry.count++;
  setBoundedMapValue(memoryLimits, key, entry, MAX_MEMORY_LIMIT_ENTRIES);
  return {
    blocked: entry.count > limit,
    retryAfter: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
  };
}

export async function clearRateLimit(
  namespace: string,
  identity: string
): Promise<void> {
  const key = rateLimitKey(namespace, identity);
  const upstash = getUpstashClient();
  if (upstash) {
    await upstash.del(key);
    return;
  }
  const redis = await getRedisClient();
  if (redis) {
    await redis.del(key);
    return;
  }
  memoryLimits.delete(key);
}

export async function consumeLoginAttempt(
  identity: string,
  limit: number,
  windowSeconds: number
): Promise<{ blocked: boolean; retryAfter: number }> {
  return consumeRateLimit('login', identity, limit, windowSeconds);
}

export async function clearLoginAttempts(identity: string): Promise<void> {
  return clearRateLimit('login', identity);
}
