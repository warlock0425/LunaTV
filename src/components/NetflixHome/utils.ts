'use client';

import type { PlayRecord } from '@/lib/db.client';
import { deduplicatePlayRecordList } from '@/lib/play-records';

export function deduplicatePlayRecords(
  records: Record<string, PlayRecord>
): (PlayRecord & { key: string })[] {
  return deduplicatePlayRecordList(
    Object.entries(records || {}).map(([key, record]) => ({ ...record, key }))
  );
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
