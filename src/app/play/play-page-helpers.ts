import { logger } from '@/lib/logger';
import { SearchResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

export const DETAIL_CACHE_KEY = 'berserker_detail_cache';
export const DETAIL_CACHE_KEY_LEGACY = 'luna_detail_cache';
export const DETAIL_CACHE_LIMIT = 100;
export const DETAIL_CACHE_TTL = 60 * 60 * 1000; // 1 小時過期，防止 M3U8 連結失效

export const DEFAULT_SKIP_CONFIG = {
  enable: false,
  intro_time: 0,
  outro_time: 0,
};

// ---------------------------------------------------------------------------
// 環境工具
// ---------------------------------------------------------------------------

export function getClientStorageType(): string {
  return (
    (typeof window !== 'undefined' && window.RUNTIME_CONFIG?.STORAGE_TYPE) ||
    process.env.NEXT_PUBLIC_STORAGE_TYPE ||
    'localstorage'
  );
}

// ---------------------------------------------------------------------------
// Detail 快取管理
// ---------------------------------------------------------------------------

export function migrateDetailCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const legacy = localStorage.getItem(DETAIL_CACHE_KEY_LEGACY);
    if (!legacy) return;
    const current = localStorage.getItem(DETAIL_CACHE_KEY);
    if (!current) {
      localStorage.setItem(DETAIL_CACHE_KEY, legacy);
    } else {
      try {
        const merged = { ...JSON.parse(legacy), ...JSON.parse(current) };
        localStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify(merged));
      } catch {
        // merge failed, keep current as-is
      }
    }
    localStorage.removeItem(DETAIL_CACHE_KEY_LEGACY);
  } catch {
    // ignore migration errors
  }
}

export function getCachedDetail(
  source: string,
  id: string
): SearchResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DETAIL_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as Record<
      string,
      { detail: SearchResult; timestamp: number }
    >;
    const entry = cache[`${source}_${id}`];
    if (entry && entry.detail) {
      if (Date.now() - entry.timestamp > DETAIL_CACHE_TTL) {
        delete cache[`${source}_${id}`];
        localStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify(cache));
        return null;
      }
      return entry.detail;
    }
  } catch (e) {
    logger.error('Failed to get cached detail:', e);
  }
  return null;
}

export function setCachedDetail(
  source: string,
  id: string,
  detail: SearchResult
): void {
  if (typeof window === 'undefined' || !source || !id || !detail) return;
  try {
    const raw = localStorage.getItem(DETAIL_CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : {};
    cache[`${source}_${id}`] = {
      detail,
      timestamp: Date.now(),
    };

    const keys = Object.keys(cache);
    if (keys.length > DETAIL_CACHE_LIMIT) {
      const entries = Object.entries(cache) as [
        string,
        { detail: SearchResult; timestamp: number },
      ][];
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, keys.length - DETAIL_CACHE_LIMIT);
      toDelete.forEach(([k]) => {
        delete cache[k];
      });
    }

    localStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    logger.error('Failed to set cached detail:', e);
  }
}

export function clearCachedDetail(source: string, id: string): void {
  if (typeof window === 'undefined' || !source || !id) return;
  try {
    const raw = localStorage.getItem(DETAIL_CACHE_KEY);
    if (!raw) return;
    const cache = JSON.parse(raw) as Record<
      string,
      { detail: SearchResult; timestamp: number }
    >;
    delete cache[`${source}_${id}`];
    localStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    logger.error('Failed to clear cached detail:', e);
  }
}
