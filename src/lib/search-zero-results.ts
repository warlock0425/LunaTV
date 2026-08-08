import { Redis as UpstashRedis } from '@upstash/redis';
import { createClient, RedisClientType } from 'redis';

import { logger } from './logger';
import { getServerStorageType } from './storage-runtime';

/**
 * 站級「搜尋零結果」收集：只存查詢詞 + 次數 + 最後時間，不綁使用者。
 * 用途：站長補 regional-title-aliases 時的真實依據，不是個人隱私紀錄。
 */

export type SearchZeroResultEntry = {
  query: string;
  count: number;
  lastAt: number;
};

export const SEARCH_ZERO_RESULTS_MAX_ENTRIES = 100;
export const SEARCH_ZERO_RESULTS_MAX_QUERY_LEN = 80;

const STORAGE_KEY = 'search:zero-results:v1';
const CJK_PATTERN = /[\u3400-\u9fff]/;
const KANA_PATTERN = /[\u3040-\u30ff]/;

const storageType = getServerStorageType();

let redisClientPromise: Promise<RedisClientType> | null = null;
let upstashClient: UpstashRedis | null = null;

const globalZeroResults = globalThis as typeof globalThis & {
  __berserkerSearchZeroResults?: SearchZeroResultEntry[];
};

function memoryStore(): SearchZeroResultEntry[] {
  globalZeroResults.__berserkerSearchZeroResults ??= [];
  return globalZeroResults.__berserkerSearchZeroResults;
}

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
      logger.error('Search zero-results Redis client error:', error);
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

/** trim + 收合空白；不合格回 null */
export function normalizeZeroResultQuery(raw: string): string | null {
  const q = (raw || '').trim().replace(/\s+/g, ' ');
  if (!q || q.length > SEARCH_ZERO_RESULTS_MAX_QUERY_LEN) return null;
  // 只收中日韓漢字查詢：台譯表要補的是這類；英文片名靠原文搜即可
  if (!CJK_PATTERN.test(q)) return null;
  // 假名為主的查詢不進譯名表候選
  if (KANA_PATTERN.test(q) && !CJK_PATTERN.test(q.replace(KANA_PATTERN, ''))) {
    return null;
  }
  return q;
}

export function sortZeroResultEntries(
  entries: SearchZeroResultEntry[]
): SearchZeroResultEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.count - a.count ||
      b.lastAt - a.lastAt ||
      a.query.localeCompare(b.query, 'zh-Hant')
  );
}

/**
 * 純函式：寫入一筆零結果查詢並裁到 maxEntries。
 * 驗收用；實際 I/O 走 recordSearchZeroResult。
 */
export function upsertZeroResultEntries(
  entries: SearchZeroResultEntry[],
  query: string,
  now: number,
  maxEntries = SEARCH_ZERO_RESULTS_MAX_ENTRIES
): SearchZeroResultEntry[] {
  const normalized = normalizeZeroResultQuery(query);
  if (!normalized || maxEntries < 1) {
    return sortZeroResultEntries(entries).slice(0, Math.max(0, maxEntries));
  }

  const byQuery = new Map<string, SearchZeroResultEntry>();
  for (const entry of entries) {
    const key = normalizeZeroResultQuery(entry.query);
    if (!key) continue;
    const prev = byQuery.get(key);
    if (!prev || entry.count > prev.count || entry.lastAt > prev.lastAt) {
      byQuery.set(key, {
        query: key,
        count: Math.max(1, Math.floor(entry.count) || 1),
        lastAt: entry.lastAt,
      });
    }
  }

  const existing = byQuery.get(normalized);
  byQuery.set(normalized, {
    query: normalized,
    count: (existing?.count || 0) + 1,
    lastAt: now,
  });

  return sortZeroResultEntries(Array.from(byQuery.values())).slice(
    0,
    maxEntries
  );
}

function parseStoredEntries(raw: unknown): SearchZeroResultEntry[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];

  const out: SearchZeroResultEntry[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const query = normalizeZeroResultQuery(String(row.query ?? ''));
    const count = Number(row.count);
    const lastAt = Number(row.lastAt);
    if (!query || !Number.isFinite(count) || count < 1) continue;
    if (!Number.isFinite(lastAt) || lastAt <= 0) continue;
    out.push({ query, count: Math.floor(count), lastAt: Math.floor(lastAt) });
  }
  return sortZeroResultEntries(out).slice(0, SEARCH_ZERO_RESULTS_MAX_ENTRIES);
}

async function loadEntries(): Promise<SearchZeroResultEntry[]> {
  try {
    const upstash = getUpstashClient();
    if (upstash) {
      const raw = await upstash.get<string | SearchZeroResultEntry[]>(
        STORAGE_KEY
      );
      return parseStoredEntries(raw);
    }
    const redis = await getRedisClient();
    if (redis) {
      const raw = await redis.get(STORAGE_KEY);
      return parseStoredEntries(raw);
    }
  } catch (error) {
    logger.warn('讀取零結果查詢失敗，改用記憶體：', error);
  }
  return sortZeroResultEntries([...memoryStore()]);
}

async function saveEntries(entries: SearchZeroResultEntry[]): Promise<void> {
  const payload = JSON.stringify(entries);
  try {
    const upstash = getUpstashClient();
    if (upstash) {
      await upstash.set(STORAGE_KEY, payload);
      return;
    }
    const redis = await getRedisClient();
    if (redis) {
      await redis.set(STORAGE_KEY, payload);
      return;
    }
  } catch (error) {
    logger.warn('寫入零結果查詢失敗，改用記憶體：', error);
  }
  globalZeroResults.__berserkerSearchZeroResults = entries;
}

/** 搜尋 API 零結果時呼叫；失敗不影響搜尋回應 */
export async function recordSearchZeroResult(
  rawQuery: string,
  now = Date.now()
): Promise<void> {
  if (!normalizeZeroResultQuery(rawQuery)) return;
  try {
    const current = await loadEntries();
    const next = upsertZeroResultEntries(
      current,
      rawQuery,
      now,
      SEARCH_ZERO_RESULTS_MAX_ENTRIES
    );
    await saveEntries(next);
  } catch (error) {
    logger.warn('記錄零結果查詢失敗：', error);
  }
}

export async function listSearchZeroResults(): Promise<
  SearchZeroResultEntry[]
> {
  try {
    return await loadEntries();
  } catch (error) {
    logger.warn('列出零結果查詢失敗：', error);
    return sortZeroResultEntries([...memoryStore()]);
  }
}

/** 測試用：清空進程內記憶體後備 */
export function resetSearchZeroResultsMemoryForTests(): void {
  globalZeroResults.__berserkerSearchZeroResults = [];
}
