import { Redis as UpstashRedis } from '@upstash/redis';
import { createClient, RedisClientType } from 'redis';

import { pruneExpiredMapValues, setBoundedMapValue } from './bounded-map';

type StorageType = 'localstorage' | 'redis' | 'kvrocks' | 'upstash';

const storageType = (process.env.STORAGE_TYPE ||
  process.env.NEXT_PUBLIC_STORAGE_TYPE ||
  'localstorage') as StorageType;

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

export async function consumeLoginAttempt(
  identity: string,
  limit: number,
  windowSeconds: number
): Promise<{ blocked: boolean; retryAfter: number }> {
  const key = `security:login:${identity}`;
  const upstash = getUpstashClient();
  if (upstash) {
    const count = Number(await upstash.incr(key));
    if (count === 1) await upstash.expire(key, windowSeconds);
    const ttl = Math.max(1, Number(await upstash.ttl(key)));
    return { blocked: count > limit, retryAfter: ttl };
  }
  const redis = await getRedisClient();
  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    const ttl = Math.max(1, await redis.ttl(key));
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

export async function clearLoginAttempts(identity: string): Promise<void> {
  const key = `security:login:${identity}`;
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
