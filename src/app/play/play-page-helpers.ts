import { logger } from '@/lib/logger';
import { needsEpisodeHydration } from '@/lib/play-page-utils';
import { SearchResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

// 鍵名沿用舊 fork，勿改——使用者本機快取靠這個 key
export const DETAIL_CACHE_KEY = 'berserker_detail_cache';
export const DETAIL_CACHE_KEY_LEGACY = 'luna_detail_cache';
export const DETAIL_CACHE_LIMIT = 300;
/** soft TTL：超過可 stale 起播，背景再刷新（SWR） */
export const DETAIL_CACHE_TTL = 60 * 60 * 1000; // 1 小時
/** hard TTL：太舊的簽章 URL 不再用來起播 */
export const DETAIL_CACHE_HARD_TTL = 24 * 60 * 60 * 1000; // 24 小時
/** 配額爆掉時一次砍掉的最舊筆數 */
const DETAIL_CACHE_QUOTA_EVICT = 50;

export type DetailCacheEntry = {
  detail: SearchResult;
  timestamp: number;
};

export type DetailCacheStore = Record<string, DetailCacheEntry>;

export type CachedDetailLookup = {
  detail: SearchResult;
  /** soft 過期：可起播，應背景刷新 */
  stale: boolean;
};

export const DEFAULT_SKIP_CONFIG = {
  enable: false,
  intro_time: 0,
  outro_time: 0,
};

/** 歷史進度晚於 canplay 抵達時，只在使用者還沒真正開始看才補 seek。 */
export const LATE_RESUME_PLAYED_THRESHOLD_SECONDS = 3;
/** HLS 尚未展開完整片長時，duration 常只有前幾個 fragment。 */
const RESUME_DURATION_MIN_SECONDS = 60;
/** 已落到目標附近，視為恢復成功。 */
const RESUME_SEEK_DONE_EPSILON_SECONDS = 5;

export function shouldSeekLateResume(
  resumeTime: number,
  currentTime: number
): boolean {
  return (
    resumeTime > LATE_RESUME_PLAYED_THRESHOLD_SECONDS &&
    currentTime < LATE_RESUME_PLAYED_THRESHOLD_SECONDS
  );
}

export function clampResumeTarget(target: number, duration: number): number {
  if (duration > 0 && target >= duration - 2) {
    return Math.max(0, duration - 5);
  }
  return target;
}

export function parsePlayUrlEpisode(
  raw: string | null | undefined
): number | null {
  if (!raw) return null;
  const episode = Number.parseInt(raw, 10);
  if (!Number.isFinite(episode) || episode < 1) return null;
  return episode;
}

/**
 * 恢復進度以播放紀錄為準。
 * 網址上的 episode=1 多半是頁面預設寫入，不能蓋掉「第 5 集 20 分」。
 * 明確的其他集數（分享連結／手動切集）才從頭播那一集。
 */
export function resolvePlayResume(options: {
  urlEpisode: number | null;
  recordIndex: number;
  recordPlayTime: number;
}): { episodeIndex: number; resumeTime: number } {
  const recordIndex =
    Number.isFinite(options.recordIndex) && options.recordIndex > 0
      ? Math.trunc(options.recordIndex)
      : 1;
  const resumeTime = Math.max(0, options.recordPlayTime || 0);
  const urlEpisode = options.urlEpisode;

  if (urlEpisode == null || urlEpisode === recordIndex || urlEpisode === 1) {
    return { episodeIndex: recordIndex - 1, resumeTime };
  }

  return { episodeIndex: urlEpisode - 1, resumeTime: 0 };
}

/**
 * 第一次套用紀錄後，後續 playRecordsUpdated 不得再改集數。
 * 切到第 5 集時會先把第 4 集進度存回去，若不擋就會被拉回第 4 集。
 */
export function shouldApplyPlayResume(options: {
  alreadyApplied: boolean;
  episodeChanged: boolean;
  currentTime: number;
}): boolean {
  if (!options.alreadyApplied) return true;
  if (options.episodeChanged) return false;
  return options.currentTime < LATE_RESUME_PLAYED_THRESHOLD_SECONDS;
}

export function isResumeDurationReliable(
  duration: number,
  target: number
): boolean {
  if (!Number.isFinite(duration) || duration <= 0) return false;
  if (target <= duration + 1) return true;
  return duration >= RESUME_DURATION_MIN_SECONDS;
}

export type ResumeSeekOutcome = 'wait' | 'seek' | 'done';

export function getResumeSeekOutcome(
  resumeTime: number,
  currentTime: number,
  duration: number
): ResumeSeekOutcome {
  if (!resumeTime || resumeTime <= 0) return 'done';
  if (Math.abs(currentTime - resumeTime) <= RESUME_SEEK_DONE_EPSILON_SECONDS) {
    return 'done';
  }
  if (!isResumeDurationReliable(duration, resumeTime)) return 'wait';
  return 'seek';
}

export function applyResumeToPlayer(
  player: { currentTime?: number; duration?: number },
  resumeTime: number
): ResumeSeekOutcome {
  const outcome = getResumeSeekOutcome(
    resumeTime,
    player.currentTime || 0,
    player.duration || 0
  );
  if (outcome === 'seek') {
    player.currentTime = clampResumeTarget(resumeTime, player.duration || 0);
  }
  return outcome;
}

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

/**
 * 純函式：依 soft/hard TTL 解讀快取條目。
 * - soft 內：fresh
 * - soft～hard：stale（不刪，呼叫端可起播 + 背景刷新）
 * - 超過 hard：hard_expired（呼叫端才刪）
 */
export function resolveCachedDetailEntry(
  entry: DetailCacheEntry | undefined | null,
  now: number,
  softTtlMs: number = DETAIL_CACHE_TTL,
  hardTtlMs: number = DETAIL_CACHE_HARD_TTL
): CachedDetailLookup | 'hard_expired' | null {
  if (!entry?.detail) return null;
  if (!Number.isFinite(entry.timestamp)) return null;
  const age = now - entry.timestamp;
  if (age > hardTtlMs) return 'hard_expired';
  if (age > softTtlMs) return { detail: entry.detail, stale: true };
  return { detail: entry.detail, stale: false };
}

/** 純函式：依 timestamp 砍最舊，保留最多 maxKeep 筆 */
export function pruneOldestDetailCacheEntries(
  cache: DetailCacheStore,
  maxKeep: number
): DetailCacheStore {
  const keys = Object.keys(cache);
  if (maxKeep < 0) maxKeep = 0;
  if (keys.length <= maxKeep) return { ...cache };

  const entries = Object.entries(cache) as [string, DetailCacheEntry][];
  entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
  const keep = entries.slice(entries.length - maxKeep);
  const next: DetailCacheStore = {};
  for (const [k, v] of keep) next[k] = v;
  return next;
}

export function getCachedDetail(
  source: string,
  id: string
): CachedDetailLookup | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DETAIL_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as DetailCacheStore;
    const key = `${source}_${id}`;
    const resolved = resolveCachedDetailEntry(cache[key], Date.now());
    if (resolved === null) return null;
    if (resolved === 'hard_expired') {
      // 只有 hard 過期才刪——soft 過期必須保留給 stale 起播（SWR）
      delete cache[key];
      try {
        localStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify(cache));
      } catch {
        // 刪除寫回失敗可忽略；下次讀仍會 hard_expired
      }
      return null;
    }
    if (resolved && typeof resolved === 'object' && 'detail' in resolved) {
      if (needsEpisodeHydration(resolved.detail)) {
        return null;
      }
    }
    return resolved;
  } catch (e) {
    logger.error('Failed to get cached detail:', e);
  }
  return null;
}

function writeDetailCache(cache: DetailCacheStore): boolean {
  try {
    localStorage.setItem(DETAIL_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

export function setCachedDetail(
  source: string,
  id: string,
  detail: SearchResult
): void {
  if (typeof window === 'undefined' || !source || !id || !detail) return;
  // 快取只存完整的詳情，若是探針網址（未水合）則不寫入 localStorage
  if (needsEpisodeHydration(detail)) return;
  try {
    const raw = localStorage.getItem(DETAIL_CACHE_KEY);
    let cache: DetailCacheStore = raw ? JSON.parse(raw) : {};
    cache[`${source}_${id}`] = {
      detail,
      timestamp: Date.now(),
    };

    if (Object.keys(cache).length > DETAIL_CACHE_LIMIT) {
      cache = pruneOldestDetailCacheEntries(cache, DETAIL_CACHE_LIMIT);
    }

    if (writeDetailCache(cache)) return;

    // 配額爆掉：再砍一批最舊的重試；仍失敗才放棄（避免每次寫入都 throw）
    const afterQuota = pruneOldestDetailCacheEntries(
      cache,
      Math.max(0, Object.keys(cache).length - DETAIL_CACHE_QUOTA_EVICT)
    );
    if (!writeDetailCache(afterQuota)) {
      logger.error(
        'Failed to set cached detail: localStorage quota exceeded after eviction'
      );
    }
  } catch (e) {
    logger.error('Failed to set cached detail:', e);
  }
}

export function clearCachedDetail(source: string, id: string): void {
  if (typeof window === 'undefined' || !source || !id) return;
  try {
    const raw = localStorage.getItem(DETAIL_CACHE_KEY);
    if (!raw) return;
    const cache = JSON.parse(raw) as DetailCacheStore;
    delete cache[`${source}_${id}`];
    writeDetailCache(cache);
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
 * 背景刷新合併後，是否可把 next 套用到畫面上的 detail。
 *
 * 雙重保險（在 mergeDetailPreservingPlayback 鎖 URL 之後）：
 * 若當前集的 m3u8 URL 仍變了，拒絕套用——否則 videoUrl 變更 → HLS 重建 →
 * 音畫/字幕累積錯位。SWR 讓這條路徑更常走，必須有純函式守門。
 *
 * 規則與 page.tsx 原判斷一致：兩邊都有 URL 且不相等 → 不套用。
 */
export function shouldApplyBackgroundDetail(
  prevDetail:
    | Pick<SearchResult, 'episodes' | 'episode_count' | 'source' | 'id'>
    | null
    | undefined,
  nextDetail:
    | Pick<SearchResult, 'episodes' | 'episode_count' | 'source' | 'id'>
    | null
    | undefined,
  episodeIndex: number
): boolean {
  if (!nextDetail?.episodes?.length) return false;
  // 若 prev 只是單集探針（未完整水合），而 next 是完整集數清單，必須套用
  if (prevDetail && needsEpisodeHydration(prevDetail)) return true;
  const prevUrl = prevDetail?.episodes?.[episodeIndex] || '';
  const nextUrl = nextDetail.episodes[episodeIndex] || '';
  if (prevUrl && nextUrl && prevUrl !== nextUrl) return false;
  return true;
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
  if (!prev?.episodes?.length || needsEpisodeHydration(prev)) {
    return mergeFreshDetail(prev, fresh, currentEpisodeIndex, {
      preserveCurrentEpisodeUrl: false,
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

export function getPlayPageRemountKey(
  source: string,
  id: string,
  title: string
): string {
  return `${source}\t${id}\t${title}`;
}

export function applyPlaybackUrlUpdates(
  href: string,
  updates: Record<string, string | number | undefined | null>,
  removeKeys: string[] = []
): string {
  const nextUrl = new URL(href);
  for (const [key, value] of Object.entries(updates)) {
    const nextValue = value === undefined || value === null ? '' : `${value}`;
    if (!nextValue || nextValue === 'undefined' || nextValue === 'null') {
      nextUrl.searchParams.delete(key);
    } else {
      nextUrl.searchParams.set(key, nextValue);
    }
  }
  for (const key of removeKeys) {
    nextUrl.searchParams.delete(key);
  }
  return nextUrl.toString();
}

export function ensureVideoSource(
  video: HTMLVideoElement | null,
  url: string
): void {
  if (!video || !url) return;
  const sources = Array.from(video.getElementsByTagName('source'));
  if (!sources.some((source) => source.src === url)) {
    sources.forEach((source) => source.remove());
    const sourceEl = document.createElement('source');
    sourceEl.src = url;
    video.appendChild(sourceEl);
  }

  video.disableRemotePlayback = false;
  if (video.hasAttribute('disableRemotePlayback')) {
    video.removeAttribute('disableRemotePlayback');
  }
}
