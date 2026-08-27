/**
 * 借用 Docker 已有的 Kvrocks／Redis 連線做搜尋執行期狀態
 * （熔斷、搜尋快取 L2）。沒有現成 client 就當單機記憶體。
 * 不另開一條 Redis。
 */

const KVROCKS_SYMBOL = Symbol.for('__MOONTV_KVROCKS_CLIENT__');
const REDIS_SYMBOL = Symbol.for('__MOONTV_REDIS_CLIENT__');

type NodeRedisLike = {
  isOpen?: boolean;
  hGetAll?(key: string): Promise<Record<string, string>>;
  hSet?(key: string, field: string, value: string): Promise<unknown>;
  hDel?(key: string, field: string): Promise<unknown>;
  expire?(key: string, seconds: number): Promise<unknown>;
  mGet?(keys: string[]): Promise<(string | null)[]>;
  set?(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del?(key: string): Promise<unknown>;
};

export interface RuntimeKv {
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, field: string, value: string): Promise<void>;
  hDel(key: string, field: string): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
  mGet(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

let testOverride: RuntimeKv | null | undefined;

export function setRuntimeKvForTests(
  client: RuntimeKv | null | undefined
): void {
  testOverride = client;
}

function wrapNodeRedis(client: NodeRedisLike): RuntimeKv {
  return {
    async hGetAll(key) {
      return (await client.hGetAll?.(key)) ?? {};
    },
    async hSet(key, field, value) {
      await client.hSet?.(key, field, value);
    },
    async hDel(key, field) {
      await client.hDel?.(key, field);
    },
    async expire(key, seconds) {
      await client.expire?.(key, seconds);
    },
    async mGet(keys) {
      if (keys.length === 0) return [];
      return (await client.mGet?.(keys)) ?? keys.map(() => null);
    },
    async set(key, value, ttlSeconds) {
      await client.set?.(key, value, { EX: Math.max(1, ttlSeconds) });
    },
    async del(key) {
      await client.del?.(key);
    },
  };
}

function discoverClient(): RuntimeKv | null {
  if (testOverride !== undefined) return testOverride;
  const candidates: NodeRedisLike[] = [
    (globalThis as Record<symbol, NodeRedisLike | undefined>)[KVROCKS_SYMBOL],
    (globalThis as Record<symbol, NodeRedisLike | undefined>)[REDIS_SYMBOL],
  ].filter((client): client is NodeRedisLike => Boolean(client));

  for (const client of candidates) {
    if (client.isOpen === false) continue;
    if (!client.hGetAll && !client.mGet) continue;
    return wrapNodeRedis(client);
  }
  return null;
}

export function getRuntimeKv(): RuntimeKv | null {
  try {
    return discoverClient();
  } catch {
    return null;
  }
}

const HYDRATE_BUDGET_MS = 150;

/** 熱路徑上 Redis 最多等這麼久，逾時就當沒有 L2。 */
export async function withRuntimeKvBudget<T>(
  work: (kv: RuntimeKv) => Promise<T>,
  fallback: T
): Promise<T> {
  const kv = getRuntimeKv();
  if (!kv) return fallback;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(kv),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), HYDRATE_BUDGET_MS);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
