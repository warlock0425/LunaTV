import { SearchResult } from '@/lib/types';

import { setBoundedMapValue } from './bounded-map';

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
const MAX_CACHE_SIZE = 500;
const SEARCH_CACHE: Map<string, CachedPageEntry> = new Map();

let cleanupTimer: NodeJS.Timeout | null = null;
let lastCleanupTime = 0;

function makeSearchCacheKey(
  sourceKey: string,
  query: string,
  page: number
): string {
  return `${sourceKey}::${query.trim()}::${page}`;
}

export function getCachedSearchPage(
  sourceKey: string,
  query: string,
  page: number
): CachedPageEntry | null {
  const key = makeSearchCacheKey(sourceKey, query, page);
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    SEARCH_CACHE.delete(key);
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
  const ttl =
    status === 'timeout'
      ? SEARCH_TIMEOUT_CACHE_TTL_MS
      : status === 'forbidden'
        ? SEARCH_FORBIDDEN_CACHE_TTL_MS
        : SEARCH_CACHE_TTL_MS;
  setBoundedMapValue(
    SEARCH_CACHE,
    key,
    {
      expiresAt: now + ttl,
      status,
      data,
      pageCount,
    },
    MAX_CACHE_SIZE
  );
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
  const keysToDelete: string[] = [];
  let sizeLimitedDeleted = 0;

  SEARCH_CACHE.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      keysToDelete.push(key);
    }
  });

  const expiredCount = keysToDelete.length;
  keysToDelete.forEach((key) => SEARCH_CACHE.delete(key));

  if (SEARCH_CACHE.size > MAX_CACHE_SIZE) {
    const entries = Array.from(SEARCH_CACHE.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);

    const toRemove = SEARCH_CACHE.size - MAX_CACHE_SIZE;
    for (let i = 0; i < toRemove; i++) {
      SEARCH_CACHE.delete(entries[i][0]);
      sizeLimitedDeleted++;
    }
  }

  lastCleanupTime = now;

  return {
    expired: expiredCount,
    total: SEARCH_CACHE.size,
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
