import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
} from 'react';

import { SearchResult } from '@/lib/types';

import {
  ApplyFreshDetailOptions,
  cacheFreshDetail,
  fetchFreshDetailFromApi,
  planApplyFreshDetail,
  RefreshEpisodesResult,
  runRefreshEpisodesIfNeeded,
} from '@/app/play/detail-refresh';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

export type UsePlayDetailRefreshArgs = {
  detailRef: MutableRefObject<SearchResult | null>;
  currentSourceRef: MutableRefObject<string>;
  currentIdRef: MutableRefObject<string>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  videoTitleRef: MutableRefObject<string>;
  episodeRefreshInFlightRef: MutableRefObject<boolean>;
  refreshEpisodesIfNeededRef: MutableRefObject<
    | ((options?: {
        preferAdvanceOnGrowth?: boolean;
        notifyWhenUnchanged?: boolean;
        notifyOnGrowth?: boolean;
      }) => Promise<RefreshEpisodesResult>)
    | null
  >;
  setDetail: Dispatch<SetStateAction<SearchResult | null>>;
  setCurrentEpisodeIndex: Dispatch<SetStateAction<number>>;
  setVideoYear: Dispatch<SetStateAction<string>>;
  setVideoTitle: Dispatch<SetStateAction<string>>;
  setVideoCover: Dispatch<SetStateAction<string>>;
  setVideoDoubanId: Dispatch<SetStateAction<number>>;
  setAvailableSources: Dispatch<SetStateAction<SearchResult[]>>;
  toast: ToastFn;
};

/**
 * 播放頁詳情刷新 / 集數追更的 React 接線層。
 * 核心決策在 detail-refresh.ts，方便單元測試。
 */
export function usePlayDetailRefresh({
  detailRef,
  currentSourceRef,
  currentIdRef,
  currentEpisodeIndexRef,
  videoTitleRef,
  episodeRefreshInFlightRef,
  refreshEpisodesIfNeededRef,
  setDetail,
  setCurrentEpisodeIndex,
  setVideoYear,
  setVideoTitle,
  setVideoCover,
  setVideoDoubanId,
  setAvailableSources,
  toast,
}: UsePlayDetailRefreshArgs) {
  const fetchFreshDetail = useCallback(
    (source: string, id: string) => fetchFreshDetailFromApi(source, id),
    []
  );

  const applyFreshDetail = useCallback(
    (
      fresh: SearchResult,
      options?: ApplyFreshDetailOptions & { syncAvailableSources?: boolean }
    ) => {
      const syncAvailableSources = options?.syncAvailableSources !== false;
      const previousIndex = currentEpisodeIndexRef.current;
      const plan = planApplyFreshDetail(
        detailRef.current,
        fresh,
        previousIndex,
        videoTitleRef.current,
        options
      );

      if (!plan.applied) {
        return {
          applied: false as const,
          episodeCountIncreased: false,
          nextEpisodeCount: plan.nextEpisodeCount,
          episodeIndex: previousIndex,
        };
      }

      cacheFreshDetail(plan.detail);
      setDetail(plan.detail);
      setVideoYear(plan.detail.year);
      setVideoTitle(plan.stableTitle);
      setVideoCover(plan.detail.poster);
      setVideoDoubanId(plan.detail.douban_id || 0);

      if (plan.shouldUpdateIndex) {
        setCurrentEpisodeIndex(plan.episodeIndex);
      }

      if (syncAvailableSources) {
        setAvailableSources((sources) =>
          sources.map((item) =>
            item.source === plan.detail.source && item.id === plan.detail.id
              ? {
                  ...item,
                  ...plan.detail,
                  episodes: plan.detail.episodes,
                  episodes_titles: plan.detail.episodes_titles,
                }
              : item
          )
        );
      }

      if (plan.growthMessage) {
        toast(plan.growthMessage, 'success');
      }

      return {
        applied: true as const,
        episodeCountIncreased: plan.episodeCountIncreased,
        nextEpisodeCount: plan.nextEpisodeCount,
        previousEpisodeCount: plan.previousEpisodeCount,
        episodeIndex: plan.episodeIndex,
        detail: plan.detail,
      };
    },
    [
      currentEpisodeIndexRef,
      detailRef,
      setAvailableSources,
      setCurrentEpisodeIndex,
      setDetail,
      setVideoCover,
      setVideoDoubanId,
      setVideoTitle,
      setVideoYear,
      toast,
      videoTitleRef,
    ]
  );

  const refreshEpisodesIfNeeded = useCallback(
    async (options?: {
      preferAdvanceOnGrowth?: boolean;
      notifyWhenUnchanged?: boolean;
      notifyOnGrowth?: boolean;
    }) => {
      return runRefreshEpisodesIfNeeded({
        source: currentSourceRef.current,
        id: currentIdRef.current,
        currentSource: currentSourceRef.current,
        currentId: currentIdRef.current,
        currentIndex: currentEpisodeIndexRef.current,
        currentEpisodeCount: detailRef.current?.episodes?.length || 0,
        inFlight: episodeRefreshInFlightRef.current,
        setInFlight: (v) => {
          episodeRefreshInFlightRef.current = v;
        },
        preferAdvanceOnGrowth: options?.preferAdvanceOnGrowth,
        notifyWhenUnchanged: options?.notifyWhenUnchanged,
        notifyOnGrowth: options?.notifyOnGrowth,
        fetchFreshDetail,
        apply: applyFreshDetail,
        notify: (message, type) => toast(message, type),
      });
    },
    [
      applyFreshDetail,
      currentEpisodeIndexRef,
      currentIdRef,
      currentSourceRef,
      detailRef,
      episodeRefreshInFlightRef,
      fetchFreshDetail,
      toast,
    ]
  );

  useEffect(() => {
    refreshEpisodesIfNeededRef.current = refreshEpisodesIfNeeded;
  }, [refreshEpisodesIfNeeded, refreshEpisodesIfNeededRef]);

  return {
    fetchFreshDetail,
    applyFreshDetail,
    refreshEpisodesIfNeeded,
  };
}
