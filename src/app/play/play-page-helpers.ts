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

// ---------------------------------------------------------------------------
// 詳情合併 / 集數追更（pure helpers）
// ---------------------------------------------------------------------------

export function getEpisodeCount(
  detail?: Pick<SearchResult, 'episodes'> | null
): number {
  return detail?.episodes?.length || 0;
}

export function clampEpisodeIndex(index: number, episodeCount: number): number {
  if (episodeCount <= 0) return 0;
  if (!Number.isFinite(index) || index < 0) return 0;
  if (index >= episodeCount) return episodeCount - 1;
  return Math.floor(index);
}

export function getEpisodeUrl(
  detail: Pick<SearchResult, 'episodes'> | null | undefined,
  index: number
): string {
  if (!detail?.episodes?.length) return '';
  if (index < 0 || index >= detail.episodes.length) return '';
  return detail.episodes[index] || '';
}

/**
 * 播放頁頂部集數徽章文案。
 * 上游常把集數標題寫成純數字「4」，直接顯示會像亂碼；
 * 有意義的集標題（非純數字）則原樣保留（可能截斷過長字串）。
 */
export function formatEpisodeBadge(
  episodeTitle: string | undefined | null,
  episodeIndex: number
): string {
  const fallback = `第 ${episodeIndex + 1} 集`;
  const raw = (episodeTitle || '').trim();
  if (!raw) return fallback;

  if (/^\d{1,4}$/.test(raw)) {
    return `第 ${Number(raw)} 集`;
  }
  // 「第4集」「第 4 集」統一成「第 4 集」
  const numbered = raw.match(/^第\s*(\d{1,4})\s*集$/);
  if (numbered) {
    return `第 ${Number(numbered[1])} 集`;
  }
  // 過長的集標題在徽章裡放不下
  if (raw.length > 16) {
    return `${Array.from(raw).slice(0, 14).join('')}…`;
  }
  return raw;
}

export interface MergeFreshDetailOptions {
  /**
   * 預設 true：背景刷新時若目前這一集只是簽章 URL 輪替，保留舊 URL，
   * 避免正在播放時因 videoUrl 變化而重建播放器。
   * 播放錯誤重試時應設為 false，強制採用最新 URL。
   */
  preserveCurrentEpisodeUrl?: boolean;
}

export interface MergeFreshDetailResult {
  applied: boolean;
  detail: SearchResult | null;
  episodeIndex: number;
  previousEpisodeCount: number;
  nextEpisodeCount: number;
  episodeCountIncreased: boolean;
  episodeCountChanged: boolean;
  /** 套用後，目前集的播放 URL 是否相對 prev 改變（preserve 後應為 false） */
  currentEpisodeUrlChanged: boolean;
  reason: 'empty_fresh' | 'source_mismatch' | 'applied';
}

/**
 * 將最新詳情合併進目前播放上下文。
 * - source/id 不一致時不覆蓋
 * - fresh 無集數時不覆蓋
 * - 集數變少時 clamp index，避免 videoUrl 被清空
 * - 可選擇保留目前集 URL，避免簽章輪替打斷播放
 */
export function mergeFreshDetail(
  prev: SearchResult | null | undefined,
  fresh: SearchResult | null | undefined,
  currentEpisodeIndex: number,
  options: MergeFreshDetailOptions = {}
): MergeFreshDetailResult {
  const preserveCurrentEpisodeUrl = options.preserveCurrentEpisodeUrl !== false;
  const previousEpisodeCount = getEpisodeCount(prev);

  if (!fresh?.episodes?.length) {
    return {
      applied: false,
      detail: null,
      episodeIndex: clampEpisodeIndex(
        currentEpisodeIndex,
        previousEpisodeCount
      ),
      previousEpisodeCount,
      nextEpisodeCount: previousEpisodeCount,
      episodeCountIncreased: false,
      episodeCountChanged: false,
      currentEpisodeUrlChanged: false,
      reason: 'empty_fresh',
    };
  }

  if (prev && (prev.source !== fresh.source || prev.id !== fresh.id)) {
    return {
      applied: false,
      detail: null,
      episodeIndex: clampEpisodeIndex(
        currentEpisodeIndex,
        previousEpisodeCount
      ),
      previousEpisodeCount,
      nextEpisodeCount: previousEpisodeCount,
      episodeCountIncreased: false,
      episodeCountChanged: false,
      currentEpisodeUrlChanged: false,
      reason: 'source_mismatch',
    };
  }

  const nextEpisodeCount = fresh.episodes.length;
  const episodeIndex = clampEpisodeIndex(currentEpisodeIndex, nextEpisodeCount);
  const episodes = fresh.episodes.slice();
  const episodesTitles = Array.isArray(fresh.episodes_titles)
    ? fresh.episodes_titles.slice()
    : [];

  let currentEpisodeUrlChanged = false;
  if (prev && previousEpisodeCount > 0) {
    const oldIndex = clampEpisodeIndex(
      currentEpisodeIndex,
      previousEpisodeCount
    );
    if (oldIndex < episodes.length) {
      const oldUrl = prev.episodes[oldIndex] || '';
      const newUrl = episodes[oldIndex] || '';
      if (oldUrl && newUrl && oldUrl !== newUrl) {
        if (preserveCurrentEpisodeUrl) {
          episodes[oldIndex] = oldUrl;
          if (Array.isArray(prev.episodes_titles)) {
            while (episodesTitles.length <= oldIndex) {
              episodesTitles.push('');
            }
            if (prev.episodes_titles[oldIndex]) {
              episodesTitles[oldIndex] = prev.episodes_titles[oldIndex];
            }
          }
          currentEpisodeUrlChanged = false;
        } else {
          currentEpisodeUrlChanged = true;
        }
      }
    }
  }

  const detail: SearchResult = {
    ...fresh,
    episodes,
    episodes_titles: episodesTitles,
  };

  return {
    applied: true,
    detail,
    episodeIndex,
    previousEpisodeCount,
    nextEpisodeCount,
    episodeCountIncreased: nextEpisodeCount > previousEpisodeCount,
    episodeCountChanged: nextEpisodeCount !== previousEpisodeCount,
    currentEpisodeUrlChanged,
    reason: 'applied',
  };
}

/** 在「已是最後一集」時，若集數增加，應前進到下一集的 index */
export function resolveEpisodeIndexAfterRefresh(options: {
  previousIndex: number;
  previousEpisodeCount: number;
  nextEpisodeCount: number;
  clampedIndex: number;
  preferAdvanceOnGrowth?: boolean;
}): number {
  const {
    previousIndex,
    previousEpisodeCount,
    nextEpisodeCount,
    clampedIndex,
    preferAdvanceOnGrowth = false,
  } = options;

  if (
    preferAdvanceOnGrowth &&
    previousEpisodeCount > 0 &&
    nextEpisodeCount > previousEpisodeCount &&
    previousIndex >= previousEpisodeCount - 1
  ) {
    const advanced = previousIndex + 1;
    if (advanced < nextEpisodeCount) return advanced;
  }

  return clampedIndex;
}

export function formatEpisodeUpdateMessage(
  previousCount: number,
  nextCount: number
): string | null {
  if (nextCount > previousCount) {
    return `已更新至第 ${nextCount} 集`;
  }
  return null;
}

/**
 * 播放中背景刷新專用：可更新集數列表／標題，但：
 * 1) 絕不縮短已在播的集數列表（上游暫時回較少集時保留 prev）
 * 2) 固定目前集的 m3u8 URL（避免重建播放器導致音畫/字幕錯位）
 * 3) 不改變 episode index（呼叫端也不應 setCurrentEpisodeIndex）
 */
export function mergeDetailPreservingPlayback(
  prev: SearchResult | null | undefined,
  fresh: SearchResult | null | undefined,
  currentEpisodeIndex: number
): MergeFreshDetailResult {
  const previousEpisodeCount = getEpisodeCount(prev);
  if (!prev?.episodes?.length) {
    return mergeFreshDetail(prev, fresh, currentEpisodeIndex, {
      preserveCurrentEpisodeUrl: true,
    });
  }
  if (!fresh?.episodes?.length) {
    return {
      applied: false,
      detail: null,
      episodeIndex: currentEpisodeIndex,
      previousEpisodeCount,
      nextEpisodeCount: previousEpisodeCount,
      episodeCountIncreased: false,
      episodeCountChanged: false,
      currentEpisodeUrlChanged: false,
      reason: 'empty_fresh',
    };
  }
  if (prev.source !== fresh.source || prev.id !== fresh.id) {
    return {
      applied: false,
      detail: null,
      episodeIndex: currentEpisodeIndex,
      previousEpisodeCount,
      nextEpisodeCount: previousEpisodeCount,
      episodeCountIncreased: false,
      episodeCountChanged: false,
      currentEpisodeUrlChanged: false,
      reason: 'source_mismatch',
    };
  }

  const playingIndex = clampEpisodeIndex(
    currentEpisodeIndex,
    previousEpisodeCount
  );
  const playingUrl = prev.episodes[playingIndex] || '';

  // 上游暫時回傳更少集數：只更新非播放欄位，集數列表保持 prev
  let episodes = fresh.episodes.slice();
  let episodesTitles = Array.isArray(fresh.episodes_titles)
    ? fresh.episodes_titles.slice()
    : [];

  if (episodes.length < previousEpisodeCount) {
    episodes = prev.episodes.slice();
    episodesTitles = Array.isArray(prev.episodes_titles)
      ? prev.episodes_titles.slice()
      : episodesTitles;
  } else {
    // 固定正在播的那一集 URL
    if (playingUrl && playingIndex < episodes.length) {
      episodes[playingIndex] = playingUrl;
    }
    if (
      Array.isArray(prev.episodes_titles) &&
      prev.episodes_titles[playingIndex]
    ) {
      while (episodesTitles.length <= playingIndex) episodesTitles.push('');
      episodesTitles[playingIndex] = prev.episodes_titles[playingIndex];
    }
  }

  const detail: SearchResult = {
    ...fresh,
    episodes,
    episodes_titles: episodesTitles,
  };

  const nextEpisodeCount = detail.episodes.length;
  const unchangedPlayingUrl =
    getEpisodeUrl(detail, playingIndex) === playingUrl || !playingUrl;

  // 播放中 URL 必須不變，否則拒絕套用（避免 hls 重建）
  if (playingUrl && !unchangedPlayingUrl) {
    return {
      applied: false,
      detail: null,
      episodeIndex: playingIndex,
      previousEpisodeCount,
      nextEpisodeCount: previousEpisodeCount,
      episodeCountIncreased: false,
      episodeCountChanged: false,
      currentEpisodeUrlChanged: true,
      reason: 'empty_fresh',
    };
  }

  return {
    applied: true,
    detail,
    episodeIndex: playingIndex, // 鎖定索引
    previousEpisodeCount,
    nextEpisodeCount,
    episodeCountIncreased: nextEpisodeCount > previousEpisodeCount,
    episodeCountChanged: nextEpisodeCount !== previousEpisodeCount,
    currentEpisodeUrlChanged: false,
    reason: 'applied',
  };
}
