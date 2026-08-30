import { SearchResult } from '@/lib/types';

import { setBoundedMapValue } from './bounded-map';
import { withRuntimeKvBudget } from './runtime-kv';

export type CachedPageStatus = 'ok' | 'timeout' | 'forbidden';

export interface CachedPageEntry {
  expiresAt: number;
  status: CachedPageStatus;
  data: SearchResult[];
  pageCount?: number;
}

const SEARCH_CACHE_TTL_MS =
  (Number(process.env.SEARCH_CACHE_TTL_MINUTES) || 120) * 60 * 1000;
const SEARCH_TIMEOUT_CACHE_TTL_MS = 2 * 60 * 1000;
const SEARCH_FORBIDDEN_CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
/** 正快取與負快取分開計，避免 timeout/403 把命中結果擠掉。 */
const MAX_POSITIVE_CACHE_SIZE = 3000;
const MAX_NEGATIVE_CACHE_SIZE = 1000;
const SEARCH_CACHE: Map<string, CachedPageEntry> = new Map();
const SEARCH_NEGATIVE_CACHE: Map<string, CachedPageEntry> = new Map();
const LOCAL_HYDRATE_TTL_MS = 5_000;
const hydratedQueries = new Map<string, number>();

let cleanupTimer: NodeJS.Timeout | null = null;
let lastCleanupTime = 0;

export function makeSearchCacheKey(
  sourceKey: string,
  query: string,
  page: number
): string {
  return `${sourceKey}::${query.trim()}::${page}`;
}

function cacheStoreFor(status: CachedPageStatus): Map<string, CachedPageEntry> {
  return status === 'ok' ? SEARCH_CACHE : SEARCH_NEGATIVE_CACHE;
}

function maxSizeFor(status: CachedPageStatus): number {
  return status === 'ok' ? MAX_POSITIVE_CACHE_SIZE : MAX_NEGATIVE_CACHE_SIZE;
}

function ttlFor(status: CachedPageStatus): number {
  if (status === 'timeout') return SEARCH_TIMEOUT_CACHE_TTL_MS;
  if (status === 'forbidden') return SEARCH_FORBIDDEN_CACHE_TTL_MS;
  return SEARCH_CACHE_TTL_MS;
}

/**
 * 與上游／SzeMeng76 相同：搜尋快取保留完整播放清單。
 * 只補齊 episode_count，不再裁成單顆探針。
 */
export function stripCachedEpisodes(results: SearchResult[]): SearchResult[] {
  return results.map((item) => {
    const urls = item.episodes || [];
    const episode_count =
      typeof item.episode_count === 'number' && item.episode_count > 0
        ? Math.max(item.episode_count, urls.length)
        : urls.length;
    return {
      ...item,
      episode_count,
    };
  });
}

function redisKey(cacheKey: string): string {
  return `lunatv:sc:v3:${cacheKey}`;
}

export function getCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number
): CachedPageEntry | null {
  const key = makeSearchCacheKey(sourceKey, query, page);
  const entry = SEARCH_CACHE.get(key) || SEARCH_NEGATIVE_CACHE.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    SEARCH_CACHE.delete(key);
    SEARCH_NEGATIVE_CACHE.delete(key);
    return null;
  }

  return entry;
}

export function setCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number,
  status: CachedPageStatus,
  data: SearchResult[],
  pageCount?: number
): void {
  ensureAutoCleanupStarted();

  const now = Date.now();
  if (now - lastCleanupTime > CACHE_CLEANUP_INTERVAL_MS) {
    performCacheCleanup();
  }

  const key = makeSearchCacheKey(sourceKey, query, page);
  const storedData = status === 'ok' ? stripCachedEpisodes(data) : [];
  const entry: CachedPageEntry = {
    expiresAt: now + ttlFor(status),
    status,
    data: storedData,
    pageCount,
  };
  const store = cacheStoreFor(status);
  store.delete(key);
  const other = status === 'ok' ? SEARCH_NEGATIVE_CACHE : SEARCH_CACHE;
  other.delete(key);
  setBoundedMapValue(store, key, entry, maxSizeFor(status));

  const kvTtlSeconds = Math.max(1, Math.ceil(ttlFor(status) / 1000));
  void withRuntimeKvBudget(async (kv) => {
    await kv.set(redisKey(key), JSON.stringify(entry), kvTtlSeconds);
    return true;
  }, false).catch(() => undefined);
}

/**
 * 一次搜尋開始時，把該 query 各源第 1 頁從 Kvrocks 整批灌進 L1。
 */
export async function hydrateSearchCacheForQuery(
  query: string,
  sourceKeys: string[]
): Promise<void> {
  const normalized = query.trim();
  if (!normalized || sourceKeys.length === 0) return;
  const now = Date.now();
  const last = hydratedQueries.get(normalized) || 0;
  if (now - last < LOCAL_HYDRATE_TTL_MS) return;

  const keys = sourceKeys.map((sourceKey) =>
    makeSearchCacheKey(sourceKey, normalized, 1)
  );
  const missing = keys.filter(
    (key) => !SEARCH_CACHE.has(key) && !SEARCH_NEGATIVE_CACHE.has(key)
  );
  if (missing.length === 0) {
    hydratedQueries.set(normalized, now);
    return;
  }

  const values = await withRuntimeKvBudget(
    (kv) => kv.mGet(missing.map((key) => redisKey(key))),
    missing.map(() => null)
  );
  hydratedQueries.set(normalized, Date.now());

  values.forEach((raw, index) => {
    if (!raw) return;
    try {
      const entry = JSON.parse(raw) as CachedPageEntry;
      if (!entry || typeof entry.expiresAt !== 'number' || !entry.status) {
        return;
      }
      if (entry.expiresAt <= Date.now()) return;
      if (entry.status === 'ok' && Array.isArray(entry.data)) {
        entry.data = stripCachedEpisodes(entry.data);
      } else {
        entry.data = [];
      }
      const key = missing[index];
      setBoundedMapValue(
        cacheStoreFor(entry.status),
        key,
        entry,
        maxSizeFor(entry.status)
      );
    } catch {
      // 略過毀損快取
    }
  });
}

export function clearSearchCacheForTests(): void {
  SEARCH_CACHE.clear();
  SEARCH_NEGATIVE_CACHE.clear();
  hydratedQueries.clear();
  lastCleanupTime = 0;
}

function ensureAutoCleanupStarted(): void {
  if (!cleanupTimer) {
    startAutoCleanup();
  }
}

function performCacheCleanup(): {
  expired: number;
  total: number;
  sizeLimited: number;
} {
  const now = Date.now();
  let expiredCount = 0;
  let sizeLimitedDeleted = 0;

  const prune = (
    store: Map<string, CachedPageEntry>,
    maxSize: number
  ): void => {
    const keysToDelete: string[] = [];
    store.forEach((entry, key) => {
      if (entry.expiresAt <= now) keysToDelete.push(key);
    });
    expiredCount += keysToDelete.length;
    keysToDelete.forEach((key) => store.delete(key));

    if (store.size > maxSize) {
      const entries = Array.from(store.entries());
      entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      const toRemove = store.size - maxSize;
      for (let i = 0; i < toRemove; i++) {
        store.delete(entries[i][0]);
        sizeLimitedDeleted++;
      }
    }
  };

  prune(SEARCH_CACHE, MAX_POSITIVE_CACHE_SIZE);
  prune(SEARCH_NEGATIVE_CACHE, MAX_NEGATIVE_CACHE_SIZE);

  for (const [query, hydratedAt] of Array.from(hydratedQueries.entries())) {
    if (hydratedAt <= now - LOCAL_HYDRATE_TTL_MS * 12) {
      hydratedQueries.delete(query);
    }
  }

  lastCleanupTime = now;

  return {
    expired: expiredCount,
    total: SEARCH_CACHE.size + SEARCH_NEGATIVE_CACHE.size,
    sizeLimited: sizeLimitedDeleted,
  };
}

function startAutoCleanup(): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    performCacheCleanup();
  }, CACHE_CLEANUP_INTERVAL_MS);

  if (typeof process !== 'undefined' && cleanupTimer.unref) {
    cleanupTimer.unref();
  }
}
