import { logger } from '@/lib/logger';
import { getStableTitle } from '@/lib/play-page-utils';
import { SearchResult } from '@/lib/types';

import {
  formatEpisodeUpdateMessage,
  mergeFreshDetail,
  resolveEpisodeIndexAfterRefresh,
  setCachedDetail,
} from './play-page-helpers';

export type ApplyFreshDetailOptions = {
  preserveCurrentEpisodeUrl?: boolean;
  preferAdvanceOnGrowth?: boolean;
  notifyOnGrowth?: boolean;
};

export type ApplyFreshDetailPlan =
  | {
      applied: false;
      episodeCountIncreased: false;
      nextEpisodeCount: number;
      episodeIndex: number;
      growthMessage: null;
    }
  | {
      applied: true;
      detail: SearchResult;
      episodeCountIncreased: boolean;
      previousEpisodeCount: number;
      nextEpisodeCount: number;
      episodeIndex: number;
      previousIndex: number;
      shouldUpdateIndex: boolean;
      growthMessage: string | null;
      stableTitle: string;
    };

/**
 * 純函式：計算「套用最新詳情」的結果，不碰 React state。
 */
export function planApplyFreshDetail(
  prev: SearchResult | null | undefined,
  fresh: SearchResult,
  previousIndex: number,
  currentTitleHint?: string,
  options: ApplyFreshDetailOptions = {}
): ApplyFreshDetailPlan {
  const preserveCurrentEpisodeUrl = options.preserveCurrentEpisodeUrl !== false;
  const preferAdvanceOnGrowth = options.preferAdvanceOnGrowth === true;
  const notifyOnGrowth = options.notifyOnGrowth === true;

  const merged = mergeFreshDetail(prev, fresh, previousIndex, {
    preserveCurrentEpisodeUrl,
  });

  if (!merged.applied || !merged.detail) {
    return {
      applied: false,
      episodeCountIncreased: false,
      nextEpisodeCount: merged.nextEpisodeCount,
      episodeIndex: previousIndex,
      growthMessage: null,
    };
  }

  // 追更的語意是「找新增的集」。若合併後集數反而變少（片源暫時抽風回傳較短
  // 清單），視為無更新——不縮短清單、不 clamp 跳集，交由下次背景刷新處理。
  // 背景刷新路徑已用 mergeDetailPreservingPlayback 做同樣保護，這裡對齊行為。
  if (
    merged.previousEpisodeCount > 0 &&
    merged.nextEpisodeCount < merged.previousEpisodeCount
  ) {
    return {
      applied: false,
      episodeCountIncreased: false,
      nextEpisodeCount: merged.previousEpisodeCount,
      episodeIndex: previousIndex,
      growthMessage: null,
    };
  }

  const nextIndex = resolveEpisodeIndexAfterRefresh({
    previousIndex,
    previousEpisodeCount: merged.previousEpisodeCount,
    nextEpisodeCount: merged.nextEpisodeCount,
    clampedIndex: merged.episodeIndex,
    preferAdvanceOnGrowth,
  });

  const growthMessage =
    notifyOnGrowth && merged.episodeCountIncreased
      ? formatEpisodeUpdateMessage(
          merged.previousEpisodeCount,
          merged.nextEpisodeCount
        )
      : null;

  return {
    applied: true,
    detail: merged.detail,
    episodeCountIncreased: merged.episodeCountIncreased,
    previousEpisodeCount: merged.previousEpisodeCount,
    nextEpisodeCount: merged.nextEpisodeCount,
    episodeIndex: nextIndex,
    previousIndex,
    shouldUpdateIndex: nextIndex !== previousIndex,
    growthMessage,
    stableTitle: getStableTitle(merged.detail.title, currentTitleHint),
  };
}

export async function fetchFreshDetailFromApi(
  source: string,
  id: string,
  fetchImpl: typeof fetch = fetch
): Promise<SearchResult | null> {
  try {
    const params = new URLSearchParams({ source, id });
    const response = await fetchImpl(`/api/detail?${params.toString()}`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = (await response.json()) as SearchResult;
    if (!data?.episodes?.length) return null;
    return data;
  } catch (err) {
    logger.error('取得最新詳情失敗:', err);
    return null;
  }
}

export type RefreshEpisodesResult = {
  updated: boolean;
  advanced: boolean;
  nextEpisodeCount: number;
};

/**
 * 核心追更流程（不含 React）。呼叫端提供 apply 與 toast。
 */
export async function runRefreshEpisodesIfNeeded(options: {
  source: string | null | undefined;
  id: string | null | undefined;
  currentSource: string | null | undefined;
  currentId: string | null | undefined;
  currentIndex: number;
  currentEpisodeCount: number;
  inFlight: boolean;
  setInFlight: (v: boolean) => void;
  preferAdvanceOnGrowth?: boolean;
  notifyWhenUnchanged?: boolean;
  notifyOnGrowth?: boolean;
  fetchFreshDetail?: typeof fetchFreshDetailFromApi;
  apply: (
    fresh: SearchResult,
    opts: ApplyFreshDetailOptions
  ) => {
    applied: boolean;
    episodeCountIncreased?: boolean;
    nextEpisodeCount: number;
    episodeIndex: number;
  };
  notify: (message: string, type: 'success' | 'error' | 'info') => void;
}): Promise<RefreshEpisodesResult> {
  const {
    source,
    id,
    preferAdvanceOnGrowth = false,
    notifyWhenUnchanged = false,
    notifyOnGrowth = true,
    fetchFreshDetail = fetchFreshDetailFromApi,
    apply,
    notify,
  } = options;

  if (!source || !id) {
    if (notifyWhenUnchanged) notify('目前仍是最新一集', 'info');
    return { updated: false, advanced: false, nextEpisodeCount: 0 };
  }
  if (options.inFlight) {
    return {
      updated: false,
      advanced: false,
      nextEpisodeCount: options.currentEpisodeCount,
    };
  }

  options.setInFlight(true);
  try {
    const fresh = await fetchFreshDetail(source, id);
    if (
      !fresh ||
      options.currentSource !== source ||
      options.currentId !== id
    ) {
      if (notifyWhenUnchanged) notify('目前仍是最新一集', 'info');
      return {
        updated: false,
        advanced: false,
        nextEpisodeCount: options.currentEpisodeCount,
      };
    }

    const beforeIndex = options.currentIndex;
    const result = apply(fresh, {
      preserveCurrentEpisodeUrl: true,
      preferAdvanceOnGrowth,
      notifyOnGrowth,
    });

    if (!result.applied) {
      if (notifyWhenUnchanged) notify('目前仍是最新一集', 'info');
      return {
        updated: false,
        advanced: false,
        nextEpisodeCount: options.currentEpisodeCount,
      };
    }

    if (!result.episodeCountIncreased) {
      if (notifyWhenUnchanged) notify('目前仍是最新一集', 'info');
      return {
        updated: false,
        advanced: false,
        nextEpisodeCount: result.nextEpisodeCount,
      };
    }

    return {
      updated: true,
      advanced: result.episodeIndex > beforeIndex,
      nextEpisodeCount: result.nextEpisodeCount,
    };
  } catch (err) {
    logger.error('檢查新集數失敗:', err);
    if (notifyWhenUnchanged) notify('檢查新集數失敗，請稍後再試', 'error');
    return {
      updated: false,
      advanced: false,
      nextEpisodeCount: options.currentEpisodeCount,
    };
  } finally {
    options.setInFlight(false);
  }
}

/** 寫入快取（供 apply 路徑共用） */
export function cacheFreshDetail(detail: SearchResult): void {
  setCachedDetail(detail.source, detail.id, detail);
}
