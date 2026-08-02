'use client';

import type { PlayRecord } from '@/lib/db.client';
import { deduplicatePlayRecordList } from '@/lib/play-records';
import { parseStorageKey } from '@/lib/storage-key';

export function deduplicatePlayRecords(
  records: Record<string, PlayRecord>
): (PlayRecord & { key: string })[] {
  return deduplicatePlayRecordList(
    Object.entries(records || {}).map(([key, record]) => ({ ...record, key }))
  );
}

/**
 * 從播放紀錄解析出可直接播放的來源與 ID。
 *
 * 紀錄的 key 才是當初寫入快取時的原始來源／ID，優先採用；欄位本身可能是
 * 舊資料留下的字串 'undefined' / 'null'，這類值視同缺漏。兩者只要缺一，
 * 就得改走 prefer 模式讓播放頁重新搜尋片源。
 */
export function resolveRecordPlayTarget(record: {
  key?: string;
  id?: string;
  vod_id?: string;
  source?: string;
}): { source: string; id: string; isPrefer: boolean } {
  const parsedKey = parseStorageKey(record.key);
  const isBlank = (value?: string) =>
    !value || value === 'undefined' || value === 'null';

  const rawId = parsedKey?.id || record.id || record.vod_id;
  const rawSource = parsedKey?.source || record.source;
  const id = isBlank(rawId) ? '' : (rawId as string);
  const source = isBlank(rawSource) ? '' : (rawSource as string);

  return { source, id, isPrefer: !id || !source };
}

/** 「第 2 / 12 集」；來源沒回報總集數時只顯示當前集。 */
export function formatEpisodeLabel(record: {
  index?: number;
  total_episodes?: number;
}): string {
  return record.total_episodes && record.total_episodes > 0
    ? `第 ${record.index} / ${record.total_episodes} 集`
    : `第 ${record.index} 集`;
}

/** 來源標籤：部分設定會在名稱前掛上 🎬，顯示時去掉。 */
export function formatSourceLabel(
  record: { source_name?: string; source?: string },
  fallbackSource = ''
): string {
  const name = record.source_name || fallbackSource || record.source || '';
  return name.replace(/^🎬\s*/, '');
}

/**
 * 觀看進度百分比。total_time 缺漏時（極少數來源不回報時長）回傳 0，
 * 由呼叫端決定是否隱藏進度條，而不是硬湊一個假的比例。
 */
export function getWatchProgress(record: {
  play_time?: number;
  total_time?: number;
}): number {
  const total = Number(record.total_time) || 0;
  if (total <= 0) return 0;
  const played = Number(record.play_time) || 0;
  // 顯示用整數百分比；避免 Hero 出現 43.076923…% 這種浮點字串
  return Math.min(100, Math.max(0, Math.round((played / total) * 100)));
}

export const DETAIL_CACHE_KEYS = [
  'berserker_detail_cache',
  'luna_detail_cache',
];
export const detailPosterInFlight = new Map<string, Promise<string>>();
export const MAX_CONCURRENT_POSTER_FETCHES = 3;
let activePosterFetches = 0;
export const posterFetchWaiters: Array<() => void> = [];

export function acquirePosterSlot(): Promise<void> {
  if (activePosterFetches < MAX_CONCURRENT_POSTER_FETCHES) {
    activePosterFetches++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    posterFetchWaiters.push(() => {
      activePosterFetches++;
      resolve();
    });
  });
}

export function releasePosterSlot() {
  activePosterFetches--;
  const next = posterFetchWaiters.shift();
  if (next) next();
}

export function getCachedDetailPoster(source: string, id: string): string {
  if (typeof window === 'undefined' || !source || !id) return '';

  for (const cacheKey of DETAIL_CACHE_KEYS) {
    try {
      const raw = localStorage.getItem(cacheKey);
      if (!raw) continue;
      const cache = JSON.parse(raw) as Record<
        string,
        { detail?: { poster?: string }; timestamp?: number }
      >;
      const poster = cache[`${source}_${id}`]?.detail?.poster || '';
      if (poster) return poster;
    } catch {
      // ignore malformed detail cache
    }
  }

  return '';
}

export function cacheDetailPoster(source: string, id: string, detail: unknown) {
  if (typeof window === 'undefined' || !source || !id || !detail) return;

  try {
    const raw = localStorage.getItem(DETAIL_CACHE_KEYS[0]);
    const cache = raw
      ? (JSON.parse(raw) as Record<
          string,
          { detail: unknown; timestamp: number }
        >)
      : {};

    cache[`${source}_${id}`] = {
      detail,
      timestamp: Date.now(),
    };

    const entries = Object.entries(cache);
    if (entries.length > 100) {
      entries
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, entries.length - 100)
        .forEach(([key]) => {
          delete cache[key];
        });
    }

    localStorage.setItem(DETAIL_CACHE_KEYS[0], JSON.stringify(cache));
  } catch {
    // detail poster is only a UI fallback; ignore cache write failures
  }
}

export async function fetchDetailPoster(
  source: string,
  id: string
): Promise<string> {
  if (!source || !id) return '';

  const cacheKey = `${source}_${id}`;
  const inFlight = detailPosterInFlight.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    await acquirePosterSlot();
    try {
      const params = new URLSearchParams({ source, id });
      const response = await fetch(`/api/detail?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!response.ok) return '';

      const detail = (await response.json()) as { poster?: string };
      if (detail?.poster) {
        cacheDetailPoster(source, id, detail);
      }
      return detail?.poster || '';
    } finally {
      releasePosterSlot();
    }
  })();

  detailPosterInFlight.set(cacheKey, request);
  try {
    return await request;
  } finally {
    detailPosterInFlight.delete(cacheKey);
  }
}
