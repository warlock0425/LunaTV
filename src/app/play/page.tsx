/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */

'use client';

import Artplayer from 'artplayer';
import Hls, { ErrorData, Events } from 'hls.js';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import {
  getCachedBangumiAliases,
  warmBangumiAliases,
} from '@/lib/bangumi-alias-cache';
import {
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  type PlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { logger } from '@/lib/logger';
import {
  formatPlayerTime,
  getResultEpisodeCount,
  getStableTitle,
  getVodHlsBufferConfig,
  HLS_APPEND_TIMEOUT_MS,
  hydrateSearchResultEpisodesWithRetry,
  isMobileUserAgent,
  isPreferredDisplayQuality,
  needsEpisodeHydration,
  pickFirstPlayableEpisodeUrl,
  pickNextPreferredSource,
  resolveLoadedEpisodeIndex,
} from '@/lib/play-page-utils';
import {
  buildPlaybackSearchPlan,
  deduplicateResults,
  fetchBangumiSearchAliases,
  mergePlayingSourceIntoAvailableSources,
  PlaybackSearchPlanStage,
} from '@/lib/play-search';
import { makeSkipIdentityParts } from '@/lib/skip-identity';
import { SearchResult, SkipConfig } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';
import {
  buildVodHlsProxyUrl,
  isVodHlsProxyUrl,
  shouldFallbackToVodProxy,
} from '@/lib/vod-hls-proxy';
import { useAutoNextCountdown } from '@/hooks/useAutoNextCountdown';
import { useFavorite } from '@/hooks/useFavorite';
import { usePlaybackSourceSearch } from '@/hooks/usePlaybackSourceSearch';
import { usePlayDetailRefresh } from '@/hooks/usePlayDetailRefresh';
import { usePlayerKeyboardShortcuts } from '@/hooks/usePlayerKeyboardShortcuts';
import { usePlayRecordPersistence } from '@/hooks/usePlayRecordPersistence';
import { useWakeLock } from '@/hooks/useWakeLock';

import EpisodeSelector from '@/components/EpisodeSelector';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import PageLayout from '@/components/PageLayout';
import PageLoading from '@/components/PageLoading';
import PlayerGestureLayer from '@/components/PlayerGestureLayer';
import { useToast } from '@/components/ToastProvider';

import { CustomHlsJsLoader } from './custom-hls-loader';
import { nextHlsFatalAction, tallySoftNetworkError } from './hls-fatal';
import {
  applyPlaybackUrlUpdates,
  applyResumeToPlayer,
  clearCachedDetail,
  DEFAULT_SKIP_CONFIG,
  ensureVideoSource,
  formatEpisodeBadge,
  formatEpisodeUpdateMessage,
  getCachedDetail,
  getClientStorageType,
  getPlayPageRemountKey,
  mergeDetailPreservingPlayback,
  mergeFreshDetail,
  migrateDetailCache,
  parsePlayUrlEpisode,
  resolvePlayResume,
  setCachedDetail,
  shouldApplyBackgroundDetail,
  shouldApplyPlayResume,
  shouldSeekLateResume,
} from './play-page-helpers';
import { PlayErrorView, PlayLoadingView } from './play-views';
import { buildSkipSettings } from './player-skip-settings';
import {
  AutoNextCountdownOverlay,
  EpisodeCollapseToggle,
  PlaybackSoftErrorOverlay,
  PlayerEpisodeBadge,
  ShortcutsHelpPanel,
  SkipButton,
  VideoDetailsPanel,
  VideoLoadingOverlay,
} from './player-ui';

// 擴展 HTMLVideoElement 類型以支援 hls 屬性
declare global {
  interface HTMLVideoElement {
    hls?: Hls;
  }
}

function PlayPageClient() {
  const searchParams = useSearchParams();

  // -----------------------------------------------------------------------------
  // 狀態變量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜尋播放源...');

  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏狀態（使用 useFavorite hook，宣告在依賴變數之後）

  // 跳過片頭片尾設定
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 自動連播開關（從 localStorage 繼承，預設開啟）
  const [autoNext, setAutoNext] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_autonext');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const autoNextRef = useRef(autoNext);
  useEffect(() => {
    autoNextRef.current = autoNext;
  }, [autoNext]);

  const [isCheckingEpisodes, setIsCheckingEpisodes] = useState(false);

  // 跳過片頭片尾按鈕狀態
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  const [showSkipOutro, setShowSkipOutro] = useState(false);
  const showSkipIntroRef = useRef(false);
  const showSkipOutroRef = useRef(false);

  // 快捷鍵幫助面板
  const [showShortcuts, setShowShortcuts] = useState(false);

  // 子母畫面狀態
  const [, setIsPiP] = useState(false);

  // 去廣告開關（從 localStorage 繼承，預設 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 影片基本資訊
  const [videoTitle, setVideoTitle] = useState(() => {
    const val = searchParams.get('title');
    return !val || val === 'undefined' || val === 'null' ? '' : val;
  });
  const [videoYear, setVideoYear] = useState(() => {
    const val = searchParams.get('year');
    return !val || val === 'undefined' || val === 'null' ? '' : val;
  });
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(0);
  // 當前源和ID
  const [currentSource, setCurrentSource] = useState(() => {
    const val = searchParams.get('source');
    return !val || val === 'undefined' || val === 'null' ? '' : val;
  });
  const [currentId, setCurrentId] = useState(() => {
    const val = searchParams.get('id');
    return !val || val === 'undefined' || val === 'null' ? '' : val;
  });

  // 搜尋所需資訊
  const [searchTitle] = useState(() => {
    const val = searchParams.get('stitle');
    return !val || val === 'undefined' || val === 'null' ? '' : val;
  });
  const [searchType] = useState(() => {
    const val = searchParams.get('stype');
    return !val || val === 'undefined' || val === 'null' ? '' : val;
  });
  const [bangumiSubjectId] = useState(() => {
    const val = searchParams.get('bgm_id');
    return !val || val === 'undefined' || val === 'null' ? '' : val;
  });

  // 是否需要優選
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true'
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集數相關：先吃網址，避免 detail 就緒時把 episode 寫成 1 蓋掉紀錄
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(() => {
    const fromUrl = parsePlayUrlEpisode(searchParams.get('episode'));
    return fromUrl ? fromUrl - 1 : 0;
  });
  const initialUrlEpisodeRef = useRef(
    parsePlayUrlEpisode(searchParams.get('episode'))
  );
  const lastGoodResumeRef = useRef(0);
  const hasAppliedResumeRef = useRef(false);
  const resumeTimeRef = useRef<number | null>(null);
  const [historyRestoreSettled, setHistoryRestoreSettled] = useState(false);

  const lockResumeAndSetEpisode = (index: number) => {
    resumeTimeRef.current = 0;
    lastGoodResumeRef.current = 0;
    hasAppliedResumeRef.current = true;
    setCurrentEpisodeIndex(index);
  };

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const initialVideoTitleRef = useRef<string>(
    (() => {
      const val = searchParams.get('title');
      return !val || val === 'undefined' || val === 'null' ? '' : val;
    })()
  );
  const initialVideoYearRef = useRef<string>(
    (() => {
      const val = searchParams.get('year');
      return !val || val === 'undefined' || val === 'null' ? '' : val;
    })()
  );
  const videoYearRef = useRef(videoYear);
  const videoCoverRef = useRef(videoCover);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);
  const {
    autoNextCountdown,
    showCountdownOverlay,
    autoNextBusyRef,
    cancelAutoNextCountdown,
    startAutoNextCountdown,
    playNextEpisodeFromCountdown,
  } = useAutoNextCountdown({
    detailRef,
    currentEpisodeIndexRef,
    setCurrentEpisodeIndex: lockResumeAndSetEpisode,
  });
  const skipHistoryRestoreRef = useRef(false);
  const episodeChangingRef = useRef(false);
  const pendingEpisodeChangeRef = useRef<number | null>(null);
  const episodeRefreshInFlightRef = useRef(false);
  const refreshEpisodesIfNeededRef = useRef<
    | ((options?: {
        preferAdvanceOnGrowth?: boolean;
        notifyWhenUnchanged?: boolean;
        notifyOnGrowth?: boolean;
      }) => Promise<{
        updated: boolean;
        advanced: boolean;
        nextEpisodeCount: number;
      }>)
    | null
  >(null);
  const bangumiSearchAliasesRef = useRef<string[]>([]);
  const detailRetryKeyRef = useRef<string | null>(null);
  const sourceChangeRequestRef = useRef(0);
  const { toast } = useToast();

  // 收藏邏輯（useFavorite hook）
  const { favorited, handleToggleFavorite } = useFavorite({
    currentSource,
    currentId,
    currentSourceRef,
    currentIdRef,
    videoTitleRef,
    videoCoverRef,
    detailRef,
    searchTitle,
  });

  useEffect(() => {
    const bgmId = Number(bangumiSubjectId);
    if (Number.isInteger(bgmId) && bgmId > 0) {
      void warmBangumiAliases(bgmId);
    }
  }, [bangumiSubjectId]);

  // 影片地址由 detail + 集數索引推導（越界時為空字串）
  // 只依賴「目前集的 URL 字串」，避免 detail 物件被背景刷新置換時
  // 觸發多餘重算；字串相同則播放器 effect 不會重建 HLS。
  const directVideoUrl = detail?.episodes?.[currentEpisodeIndex] || '';
  const playbackSlotKey = `${currentSource}+${currentId}+${currentEpisodeIndex}`;
  const [vodProxySlot, setVodProxySlot] = useState<string | null>(null);
  const [playerReloadToken, setPlayerReloadToken] = useState(0);
  const useVodProxy = vodProxySlot === playbackSlotKey;
  const videoUrl =
    useVodProxy && directVideoUrl && currentSource
      ? buildVodHlsProxyUrl(directVideoUrl, currentSource)
      : directVideoUrl;
  const totalEpisodes = detail?.episodes?.length || 0;
  const lastVolumeRef = useRef<number>(0.7);
  const lastPlaybackRateRef = useRef<number>(
    typeof window !== 'undefined'
      ? parseFloat(localStorage.getItem('playbackRate') || '1') || 1
      : 1.0
  );

  useEffect(() => {
    detailRetryKeyRef.current = null;
  }, [currentSource, currentId, currentEpisodeIndex]);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
    videoCoverRef.current = videoCover;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
    videoCover,
  ]);

  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 儲存優選時的測速結果，避免EpisodeSelector重複測速

  // 摺疊狀態（僅在 lg 及以上熒幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 換源載入狀態
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');
  /** 播放中錯誤：留在播放頁，用蒙層提供重試／換源（不整頁踢出） */
  const [playbackSoftError, setPlaybackSoftError] = useState<string | null>(
    null
  );

  // 用於追蹤初始化 loading setTimeout，元件卸載時清理
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  const lastLoadedVideoUrlRef = useRef<string>('');

  // Wake Lock（螢幕常亮）
  const { requestWakeLock, releaseWakeLock } = useWakeLock();

  // -----------------------------------------------------------------------------
  // 工具函數（Utils）
  // -----------------------------------------------------------------------------

  const replacePlaybackUrl = (
    updates: Record<string, string | number | undefined | null>,
    removeKeys: string[] = []
  ) => {
    if (typeof window === 'undefined') return;
    window.history.replaceState(
      {},
      '',
      applyPlaybackUrlUpdates(window.location.href, updates, removeKeys)
    );
  };

  // 清理播放器資源的統一函數
  const cleanupPlayer = (resetCountdownUi = true) => {
    lastLoadedVideoUrlRef.current = '';
    cancelAutoNextCountdown(resetCountdownUi);

    if (artPlayerRef.current) {
      try {
        // 銷燬 HLS 實例
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
        }

        // 銷燬 ArtPlayer 實例
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;

        logger.debug('播放器資源已清理');
      } catch (err) {
        logger.warn('清理播放器資源時出錯:', err);
        artPlayerRef.current = null;
      }
    }
  };

  // 跳過片頭片尾設定項（Artplayer 建立與設定面板重設共用）
  const buildSkipSettingsForPlayer = () =>
    buildSkipSettings({
      getPlayer: () => artPlayerRef.current,
      skipConfigRef,
      onChange: (cfg) => handleSkipConfigChange(cfg),
    });

  const syncSkipSettingsToPlayer = () => {
    if (!artPlayerRef.current) return;
    const { skipToggle, setIntro, setOutro } = buildSkipSettingsForPlayer();
    artPlayerRef.current.setting.update(skipToggle);
    artPlayerRef.current.setting.update(setIntro);
    artPlayerRef.current.setting.update(setOutro);
  };

  // 跳過片頭片尾設定相關函數
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;
    const previous = skipConfigRef.current;
    const identity = makeSkipIdentityParts({
      doubanId: videoDoubanId,
      title: videoTitleRef.current,
      year: videoYearRef.current,
    });

    try {
      setSkipConfig(newConfig);
      skipConfigRef.current = newConfig;
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
        if (identity) {
          await deleteSkipConfig(identity.source, identity.id);
        }
        syncSkipSettingsToPlayer();
      } else {
        if (identity) {
          await saveSkipConfig(identity.source, identity.id, newConfig);
        }
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }
      logger.debug('跳過片頭片尾設定已儲存:', newConfig);
    } catch (err) {
      logger.error('儲存跳過片頭片尾設定失敗:', err);
      setSkipConfig(previous);
      skipConfigRef.current = previous;
      syncSkipSettingsToPlayer();
    }
  };

  const isBangumiCardSearch = Boolean(bangumiSubjectId);
  const {
    availableSources,
    setAvailableSources,
    sourceSearchLoading,
    setSourceSearchLoading,
    sourceSearchError,
    setSourceSearchError,
    precomputedVideoInfo,
    preferBestSource,
    fetchSourcesData,
    abortActiveSpeedTests,
  } = usePlaybackSourceSearch({
    initialVideoTitleRef,
    initialVideoYearRef,
    videoYearRef,
    bangumiSearchAliasesRef,
    searchTitle,
    searchType,
  });

  useEffect(() => {
    return () => {
      abortActiveSpeedTests();
    };
  }, [abortActiveSpeedTests]);

  useEffect(() => {
    if (!detail || !currentSource || !currentId) return;
    if (!historyRestoreSettled) return;
    replacePlaybackUrl({
      source: currentSource,
      id: currentId,
      title: getStableTitle(videoTitle, detail.title),
      year: videoYear || detail.year,
      episode: currentEpisodeIndex + 1,
    });
  }, [
    currentEpisodeIndex,
    currentId,
    currentSource,
    detail,
    historyRestoreSettled,
    videoTitle,
    videoYear,
  ]);

  // 進入頁面時直接取得全部源資訊
  useEffect(() => {
    let active = true;

    const fetchSourceDetail = async (
      source: string,
      id: string
    ): Promise<SearchResult[]> => {
      try {
        const params = new URLSearchParams({ source, id });
        const detailResponse = await fetch(`/api/detail?${params.toString()}`, {
          cache: 'no-store',
        });
        if (!detailResponse.ok) {
          throw new Error('取得影片詳情失敗');
        }
        const detailData = (await detailResponse.json()) as SearchResult;
        return [detailData];
      } catch (err) {
        logger.error('取得影片詳情失敗:', err);
        return [];
      }
    };

    const ensureBangumiSearchAliases = async (): Promise<string[]> => {
      if (!bangumiSubjectId || bangumiSearchAliasesRef.current.length > 0) {
        return bangumiSearchAliasesRef.current;
      }

      const bgmId = Number(bangumiSubjectId);
      const cachedAliases =
        Number.isInteger(bgmId) && bgmId > 0
          ? getCachedBangumiAliases(bgmId)
          : null;
      if (cachedAliases) {
        bangumiSearchAliasesRef.current = cachedAliases;
        return cachedAliases;
      }

      const aliases = await fetchBangumiSearchAliases(bangumiSubjectId);
      bangumiSearchAliasesRef.current = aliases;
      return aliases;
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要參數');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '🎬 正在取得影片詳情...'
          : '🔍 正在搜尋播放源...'
      );
      setSourceSearchLoading(true);
      setSourceSearchError(null);

      let isBgSearchStarted = false;
      try {
        let sourcesInfo: SearchResult[] = [];
        let detailData: SearchResult | null = null;
        let shouldCompleteSourceSearchInBackground = false;

        const isDirectLoad =
          currentSource && currentId && !needPreferRef.current;

        if (isDirectLoad) {
          logger.debug(
            `Direct load path for source: ${currentSource}, id: ${currentId}`
          );
          const cachedLookup = getCachedDetail(currentSource, currentId);
          if (cachedLookup && !needsEpisodeHydration(cachedLookup.detail)) {
            // soft 過期也算命中：先 stale 起播，背景 refreshDetailInBackground
            // 會走 mergeDetailPreservingPlayback（不得直接 setDetail 換 URL）
            logger.debug(
              `Cache hit for direct load detail${
                cachedLookup.stale ? ' (stale, SWR)' : ''
              }:`,
              cachedLookup.detail.title
            );
            detailData = cachedLookup.detail;
            sourcesInfo = [detailData];
          } else {
            logger.debug('Cache miss for direct load detail, fetching...');
            const currentDetailList = await fetchSourceDetail(
              currentSource,
              currentId
            );
            if (currentDetailList.length > 0) {
              detailData = currentDetailList[0];
              sourcesInfo = [detailData];
              setCachedDetail(currentSource, currentId, detailData);
            } else {
              logger.warn(
                `Failed to fetch detail for direct load: ${currentSource}, ${currentId}`
              );
              // 直連詳情回空才改文案；本來就沒 source/id 的搜尋路徑不要說「詳情失敗」
              setLoadingStage('searching');
              setLoadingMessage('🔍 詳情取得失敗，改以片名搜尋其他片源…');
            }
          }
        }

        if (!detailData) {
          const searchedQueries = new Set<string>();
          const searchQueries = async (
            queries: string[],
            searchOptions: {
              directSearch?: boolean;
              translationFallback?: boolean;
            } = {}
          ) => {
            for (const query of queries) {
              const queryKey = query.trim();
              if (!queryKey || searchedQueries.has(queryKey)) continue;
              searchedQueries.add(queryKey);

              const queryResults = await fetchSourcesData(
                query,
                (newResults) => {
                  setAvailableSources((prev) =>
                    deduplicateResults([...prev, ...newResults])
                  );
                },
                {
                  strictCardMatch: isBangumiCardSearch,
                  directSearch: searchOptions.directSearch,
                  translationFallback: searchOptions.translationFallback,
                }
              );

              if (queryResults.length > 0) {
                sourcesInfo = deduplicateResults([
                  ...sourcesInfo,
                  ...queryResults,
                ]);
              }
            }
          };

          const executeSearchPlan = async (
            stages: PlaybackSearchPlanStage[]
          ) => {
            for (const stage of stages) {
              if (sourcesInfo.length > 0) break;
              await searchQueries(stage.queries.slice(0, stage.limit), {
                directSearch: stage.directSearch,
                translationFallback: stage.translationFallback,
              });
              if (!active) return;
            }
          };

          const shouldRunFastPlan =
            !currentSource || !currentId || needPreferRef.current;
          if (shouldRunFastPlan) {
            await executeSearchPlan(
              buildPlaybackSearchPlan({
                title: videoTitle,
                searchTitle,
                isBangumiCardSearch,
              })
            );
          } else {
            await executeSearchPlan(
              buildPlaybackSearchPlan({
                title: videoTitle,
                searchTitle,
                isBangumiCardSearch: false,
                includeFastStage: false,
              })
            );
          }

          if (isBangumiCardSearch && sourcesInfo.length === 0) {
            const bangumiAliases = await ensureBangumiSearchAliases();
            await executeSearchPlan(
              buildPlaybackSearchPlan({
                title: videoTitle,
                searchTitle,
                aliases: bangumiAliases,
                isBangumiCardSearch,
                includeFastStage: false,
              })
            );
          }

          shouldCompleteSourceSearchInBackground =
            isBangumiCardSearch && sourcesInfo.length > 0;

          if (
            currentSource &&
            currentId &&
            !sourcesInfo.some(
              (source) =>
                source.source === currentSource && source.id === currentId
            )
          ) {
            const currentDetailList = await fetchSourceDetail(
              currentSource,
              currentId
            );
            if (!active) return;
            if (currentDetailList.length > 0) {
              // 網址上的 source/id 來自觀看紀錄；片名季數對不上也要留在換源清單
              sourcesInfo = mergePlayingSourceIntoAvailableSources(
                sourcesInfo,
                currentDetailList[0]
              );
            }
          }
        }

        const ensurePlayableEpisodes = async (
          candidate: SearchResult
        ): Promise<SearchResult | null> => {
          const targetIndex = Math.max(
            0,
            (initialUrlEpisodeRef.current || 1) - 1
          );
          if (
            candidate.episodes?.length &&
            !needsEpisodeHydration(candidate) &&
            targetIndex < candidate.episodes.length
          ) {
            return candidate;
          }
          let last = candidate;
          for (let attempt = 0; attempt < 3; attempt++) {
            const fresh = await fetchSourceDetail(
              candidate.source,
              candidate.id
            );
            if (fresh[0]?.episodes?.length) {
              last = {
                ...candidate,
                ...fresh[0],
                source: candidate.source,
                id: candidate.id,
              };
              if (
                !needsEpisodeHydration(last) ||
                last.episodes.length >= getResultEpisodeCount(candidate)
              ) {
                return last;
              }
            }
          }
          return last.episodes?.length ? last : null;
        };

        if (sourcesInfo.length === 0) {
          setError('未找到匹配結果');
          setLoading(false);
          return;
        }

        if (!detailData) {
          detailData = sourcesInfo[0];
          // 指定源和id且無需優選
          if (currentSource && currentId && !needPreferRef.current) {
            const target = sourcesInfo.find(
              (source) =>
                source.source === currentSource && source.id === currentId
            );
            if (target) {
              detailData = target;
            } else {
              logger.warn(
                `未找到指定的源 ${currentSource} 和 ID ${currentId}，自動退回到優選其他可用片源`
              );
              if (optimizationEnabled) {
                setLoadingStage('preferring');
                setLoadingMessage('⚡ 正在優選最佳播放源...');
                const preferred = await preferBestSource(sourcesInfo);
                detailData = preferred.source;
                if (preferred.noHighQualityNotice) {
                  toast('此片無 1080p 以上來源', 'info');
                }
              } else {
                detailData = sourcesInfo[0];
              }
            }
          }

          // 未指定源和 id 或需要優選，且開啟優選開關
          if (
            (!currentSource || !currentId || needPreferRef.current) &&
            optimizationEnabled &&
            (!isBangumiCardSearch || needPreferRef.current)
          ) {
            setLoadingStage('preferring');
            setLoadingMessage('⚡ 正在優選最佳播放源（優先 1080p+）...');

            const preferred = await preferBestSource(sourcesInfo);
            detailData = preferred.source;
            if (preferred.noHighQualityNotice) {
              toast('此片無 1080p 以上來源', 'info');
            }
            if (!active) return;
          }
        }

        const targetInitialIndex = Math.max(
          0,
          (initialUrlEpisodeRef.current || 1) - 1
        );
        if (
          detailData &&
          (needsEpisodeHydration(detailData) ||
            targetInitialIndex >= detailData.episodes.length)
        ) {
          setLoadingStage('fetching');
          setLoadingMessage('🎬 正在取得可播放集數...');
          const playable = await ensurePlayableEpisodes(detailData);
          if (!active) return;
          if (!playable) {
            setError('無法取得可播放的集數');
            setLoading(false);
            return;
          }
          detailData = playable;
          sourcesInfo = sourcesInfo.map((source) =>
            source.source === playable.source && source.id === playable.id
              ? playable
              : source
          );
        }

        setAvailableSources(sourcesInfo);
        if (detailData) {
          setCachedDetail(detailData.source, detailData.id, detailData);
        }

        logger.debug('Direct load detail resolved:', {
          source: detailData.source,
          id: detailData.id,
        });

        setNeedPrefer(false);
        setCurrentSource(detailData.source);
        setCurrentId(detailData.id);
        setVideoYear(detailData.year);
        setVideoTitle(getStableTitle(detailData.title, videoTitleRef.current));
        setVideoCover(detailData.poster);
        setVideoDoubanId(detailData.douban_id || 0);
        setDetail(detailData);
        if (currentEpisodeIndex >= detailData.episodes.length) {
          setCurrentEpisodeIndex(0);
        }

        // 規範URL參數
        replacePlaybackUrl(
          {
            source: detailData.source,
            id: detailData.id,
            year: detailData.year,
            title: getStableTitle(detailData.title, videoTitleRef.current),
            bgm_id: bangumiSubjectId || undefined,
          },
          ['prefer']
        );

        setLoadingStage('ready');
        setLoadingMessage('✨ 準備就緒，即將開始播放...');

        // 短暫延遲確保 UI 過渡流暢
        const loadingTimer = setTimeout(
          () => {
            setLoading(false);
          },
          isDirectLoad ? 50 : 300
        );
        loadingTimerRef.current = loadingTimer;

        // 背景非阻塞更新目前影片的最新詳情
        // （搜尋結果可能來自伺服器搜尋快取，集數需以詳情 API 為準）
        const refreshDetailInBackground = async (
          base: SearchResult
        ): Promise<SearchResult> => {
          try {
            const freshDetailList = await fetchSourceDetail(
              base.source,
              base.id
            );
            if (!active || freshDetailList.length === 0) return base;
            const freshDetail = freshDetailList[0];
            // 播放中背景刷新：可增加集數，但絕不改正在播的 URL/集數索引
            // （否則會重建 HLS，可能造成音畫或字幕錯位）
            const previousIndex = currentEpisodeIndexRef.current;
            const merged = mergeDetailPreservingPlayback(
              detailRef.current || base,
              freshDetail,
              previousIndex
            );
            if (!merged.applied || !merged.detail) return base;
            if (!active) return base;

            setCachedDetail(base.source, base.id, merged.detail);

            // 正在播放時：若集數沒增加，不要 setDetail（避免整頁重渲與潛在播放器擾動）
            const video = artPlayerRef.current?.video as
              HTMLVideoElement | undefined;
            const isActivelyPlaying = Boolean(
              video && !video.paused && video.currentTime > 0.25
            );
            if (isActivelyPlaying && !merged.episodeCountIncreased) {
              return detailRef.current || base;
            }

            setDetail((prevDetail) => {
              const again = mergeDetailPreservingPlayback(
                prevDetail || base,
                freshDetail,
                currentEpisodeIndexRef.current
              );
              if (!again.applied || !again.detail) return prevDetail;
              // 雙重保險：播放 URL 變了就不套用（純函式守門，SWR 後更常走）
              if (
                !shouldApplyBackgroundDetail(
                  prevDetail,
                  again.detail,
                  currentEpisodeIndexRef.current
                )
              ) {
                return prevDetail;
              }
              return again.detail;
            });
            // 背景路徑刻意不 setCurrentEpisodeIndex
            if (merged.episodeCountIncreased) {
              const message = formatEpisodeUpdateMessage(
                merged.previousEpisodeCount,
                merged.nextEpisodeCount
              );
              if (message) toast(message, 'success');
            }
            return merged.detail;
          } catch (detailErr) {
            logger.error('背景重新整理詳情失敗:', detailErr);
            return base;
          }
        };

        // 如果是直接載入，背景非阻塞檢索其他可用片源與最新詳情
        if (
          (isDirectLoad || shouldCompleteSourceSearchInBackground) &&
          detailData
        ) {
          isBgSearchStarted = true;
          const runBackgroundSearch = async () => {
            try {
              // 1. 背景非阻塞更新目前影片的最新詳情
              const currentDetail = await refreshDetailInBackground(
                detailData as SearchResult
              );
              if (!active) return;

              // 2. 背景搜尋其他播放源 (維持原本邏輯，但使用最新的 currentDetail)
              let bgSourcesInfo: SearchResult[] = [];
              const backgroundStage = buildPlaybackSearchPlan({
                title: videoTitle || currentDetail.title,
                searchTitle,
                isBangumiCardSearch: false,
              }).find((stage) => stage.reason === 'mainland');

              for (const query of (backgroundStage?.queries || []).slice(
                0,
                backgroundStage?.limit || 0
              )) {
                const queryResults = await fetchSourcesData(
                  query,
                  (newResults) => {
                    setAvailableSources((prev) =>
                      deduplicateResults([...prev, ...newResults])
                    );
                  },
                  {
                    strictCardMatch: isBangumiCardSearch,
                    directSearch: backgroundStage?.directSearch,
                  }
                );
                if (!active) return;

                if (queryResults.length > 0) {
                  bgSourcesInfo = deduplicateResults([
                    ...bgSourcesInfo,
                    ...queryResults,
                  ]);
                }
              }

              setAvailableSources((prev) =>
                mergePlayingSourceIntoAvailableSources(
                  bgSourcesInfo,
                  currentDetail,
                  prev
                )
              );
            } catch (bgErr) {
              logger.error('背景搜尋其他播放源失敗:', bgErr);
            } finally {
              setSourceSearchLoading(false);
            }
          };
          runBackgroundSearch();
        } else if (detailData) {
          // 搜尋路徑進入：詳情可能來自搜尋快取，背景重新整理確保集數最新
          void refreshDetailInBackground(detailData as SearchResult);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '載入失敗');
        setSourceSearchError(err instanceof Error ? err.message : '搜尋失敗');
        setLoading(false);
      } finally {
        if (active && !isBgSearchStarted) {
          setSourceSearchLoading(false);
        }
      }
    };

    if (typeof window !== 'undefined') migrateDetailCache();
    initAll();
    // cleanup：元件卸載時清除 loading timer，避免 setState on unmounted component
    return () => {
      active = false;
      if (loadingTimerRef.current) {
        clearTimeout(loadingTimerRef.current);
        loadingTimerRef.current = null;
      }
    };
  }, []);

  // 播放記錄處理 — 等待 currentSource + currentId 就緒後執行
  useEffect(() => {
    if (!currentSource || !currentId) return;

    let cancelled = false;
    const skipHistory = skipHistoryRestoreRef.current;
    if (skipHistory) {
      skipHistoryRestoreRef.current = false;
    }

    const pickRecord = (allRecords: Record<string, PlayRecord>) => {
      const key = generateStorageKey(currentSource, currentId);
      let record: PlayRecord | undefined = allRecords[key];
      if (!record) {
        record =
          Object.values(allRecords).find(
            (r) =>
              r &&
              (r.vod_id === currentId ||
                r.id === currentId ||
                (r.source === currentSource && r.vod_id === currentId)) &&
              r.source === currentSource
          ) ?? undefined;
      }
      return record;
    };

    const applyResumeFromRecord = (record: PlayRecord | undefined) => {
      if (cancelled || skipHistory || !record) return;

      const { episodeIndex: targetIndex, resumeTime: targetTime } =
        resolvePlayResume({
          urlEpisode: initialUrlEpisodeRef.current,
          recordIndex: typeof record.index === 'number' ? record.index : 1,
          recordPlayTime: record.play_time || 0,
        });

      const player = artPlayerRef.current;
      const currentTime = player?.currentTime || 0;
      const episodeChanged = currentEpisodeIndexRef.current !== targetIndex;

      if (
        !shouldApplyPlayResume({
          alreadyApplied: hasAppliedResumeRef.current,
          episodeChanged,
          currentTime,
        })
      ) {
        return;
      }
      hasAppliedResumeRef.current = true;

      currentEpisodeIndexRef.current = targetIndex;
      setCurrentEpisodeIndex(targetIndex);

      if (targetTime > 3) {
        resumeTimeRef.current = targetTime;
        lastGoodResumeRef.current = targetTime;
        if (
          !episodeChanged &&
          player &&
          shouldSeekLateResume(targetTime, currentTime)
        ) {
          try {
            applyResumeToPlayer(player, targetTime);
          } catch (err) {
            logger.warn('恢復播放進度失敗:', err);
          }
        }
      } else {
        resumeTimeRef.current = 0;
      }
    };

    const initFromHistory = async () => {
      if (skipHistory) {
        hasAppliedResumeRef.current = true;
        setHistoryRestoreSettled(true);
        return;
      }
      try {
        const allRecords = await getAllPlayRecords();
        applyResumeFromRecord(pickRecord(allRecords));
      } catch (err) {
        logger.error('讀取播放記錄失敗:', err);
      } finally {
        if (!cancelled) setHistoryRestoreSettled(true);
      }
    };

    initFromHistory();

    const unsubscribe = subscribeToDataUpdates<Record<string, PlayRecord>>(
      'playRecordsUpdated',
      (records) => {
        applyResumeFromRecord(pickRecord(records));
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [currentSource, currentId]);

  // 跳過片頭片尾設定處理：優先用片名／豆瓣身分，換源仍沿用同一套秒數。
  useEffect(() => {
    if (!currentSource || !currentId) return;

    let cancelled = false;
    const identity = makeSkipIdentityParts({
      doubanId: videoDoubanId,
      title: videoTitle,
      year: videoYear,
    });
    const identityKey = identity
      ? generateStorageKey(identity.source, identity.id)
      : null;
    const sourceKey = generateStorageKey(currentSource, currentId);

    const applySkip = (config: SkipConfig | null | undefined) => {
      if (cancelled) return;
      const nextConfig = config || DEFAULT_SKIP_CONFIG;
      setSkipConfig(nextConfig);
      skipConfigRef.current = nextConfig;
      syncSkipSettingsToPlayer();
    };

    const initSkipConfig = async () => {
      try {
        const byIdentity = identity
          ? await getSkipConfig(identity.source, identity.id)
          : null;
        if (cancelled) return;
        if (byIdentity) {
          applySkip(byIdentity);
          return;
        }
        const bySource = await getSkipConfig(currentSource, currentId);
        if (cancelled) return;
        applySkip(bySource);
        if (bySource && identity) {
          try {
            await saveSkipConfig(identity.source, identity.id, bySource);
          } catch {
            // 遷移失敗不擋播放
          }
        }
      } catch (err) {
        logger.error('讀取跳過片頭片尾設定失敗:', err);
      }
    };

    void initSkipConfig();

    const unsubscribe = subscribeToDataUpdates<Record<string, SkipConfig>>(
      'skipConfigsUpdated',
      (configs) => {
        applySkip(
          (identityKey ? configs[identityKey] : undefined) || configs[sourceKey]
        );
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [currentSource, currentId, videoDoubanId, videoTitle, videoYear]);

  // 處理換源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    const requestId = ++sourceChangeRequestRef.current;
    const isLatestRequest = () => sourceChangeRequestRef.current === requestId;
    try {
      // 換源等同手動介入，先中止進行中的自動連播倒數
      cancelAutoNextCountdown();
      setPlaybackSoftError(null);
      // 顯示換源載入狀態
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 記錄當前播放進度（僅在同一集數切換時恢復）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      const targetDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!targetDetail) {
        if (isLatestRequest()) {
          setError('未找到匹配結果');
          setIsVideoLoading(false);
        }
        return;
      }
      logger.debug('換源前當前播放時間:', currentPlayTime);

      if (!isLatestRequest()) return;

      let newDetail = targetDetail;
      const playingIndex = currentEpisodeIndexRef.current;
      const missingPlayable = !pickFirstPlayableEpisodeUrl(newDetail.episodes);
      const incompleteForCurrent =
        playingIndex >= (newDetail.episodes?.length || 0);
      if (
        missingPlayable ||
        needsEpisodeHydration(newDetail) ||
        incompleteForCurrent
      ) {
        newDetail = await hydrateSearchResultEpisodesWithRetry(
          newDetail,
          undefined,
          {
            force: missingPlayable || incompleteForCurrent,
            attempts: 3,
          }
        );
        if (!isLatestRequest()) return;
        if (!pickFirstPlayableEpisodeUrl(newDetail.episodes)) {
          setIsVideoLoading(false);
          toast('無法取得此來源的播放清單', 'error');
          return;
        }
        setAvailableSources((prev) =>
          prev.map((item) =>
            item.source === newDetail.source && item.id === newDetail.id
              ? newDetail
              : item
          )
        );
      }

      setCachedDetail(newSource, newId, newDetail);

      // 嘗試跳轉到當前正在播放的集數
      let targetIndex = playingIndex;

      // 如果當前集數超出新源的範圍，則跳轉到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 如果仍然是同一集數且播放進度有效，則在播放器就緒後恢復到原始進度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL參數（不重新整理頁面）
      replacePlaybackUrl({
        source: newSource,
        id: newId,
        year: newDetail.year,
        title: getStableTitle(newDetail.title, newTitle, videoTitleRef.current),
        episode: targetIndex + 1,
        stitle: searchTitle || undefined,
        stype: searchType || undefined,
      });

      setVideoTitle(
        getStableTitle(newDetail.title, newTitle, videoTitleRef.current)
      );
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      skipHistoryRestoreRef.current = true;
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);

      // 背景重新整理最新詳情：availableSources 來自搜尋結果（可能吃到
      // 伺服器搜尋快取的舊集數），換源後需以詳情 API 為準更新選集列表
      void (async () => {
        try {
          const params = new URLSearchParams({ source: newSource, id: newId });
          const response = await fetch(`/api/detail?${params.toString()}`, {
            cache: 'no-store',
          });
          if (!response.ok) return;
          const freshDetail = (await response.json()) as SearchResult;
          if (!freshDetail?.episodes?.length) return;
          // 期間使用者可能又換了源，確認仍停留在本源才套用重新整理結果
          if (
            !isLatestRequest() ||
            currentSourceRef.current !== newSource ||
            currentIdRef.current !== newId
          ) {
            return;
          }
          const previousIndex = currentEpisodeIndexRef.current;
          const merged = mergeDetailPreservingPlayback(
            detailRef.current,
            freshDetail,
            previousIndex
          );
          if (!merged.applied || !merged.detail) return;
          setCachedDetail(newSource, newId, merged.detail);
          setDetail((prevDetail) => {
            const again = mergeDetailPreservingPlayback(
              prevDetail,
              freshDetail,
              currentEpisodeIndexRef.current
            );
            if (!again.applied || !again.detail) return prevDetail;
            if (
              !shouldApplyBackgroundDetail(
                prevDetail,
                again.detail,
                currentEpisodeIndexRef.current
              )
            ) {
              return prevDetail;
            }
            return again.detail;
          });
          // 換源後背景刷新同樣不強制改集數索引；僅在確實越界時校正
          if (
            currentEpisodeIndexRef.current >= merged.nextEpisodeCount &&
            merged.nextEpisodeCount > 0
          ) {
            setCurrentEpisodeIndex(merged.nextEpisodeCount - 1);
          }
          if (merged.episodeCountIncreased) {
            const message = formatEpisodeUpdateMessage(
              merged.previousEpisodeCount,
              merged.nextEpisodeCount
            );
            if (message) toast(message, 'success');
          }
        } catch (refreshErr) {
          logger.error('換源後背景重新整理詳情失敗:', refreshErr);
        }
      })();
    } catch (err) {
      if (!isLatestRequest()) return;
      // 隱藏換源載入狀態
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '換源失敗');
    }
  };

  // ---------------------------------------------------------------------------
  // 詳情刷新 / 集數追更（核心邏輯在 detail-refresh + usePlayDetailRefresh）
  const { refreshEpisodesIfNeeded } = usePlayDetailRefresh({
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
  });

  // ---------------------------------------------------------------------------
  // 集數切換
  // ---------------------------------------------------------------------------
  // 處理集數切換
  const handleEpisodeChange = async (episodeNumber: number) => {
    if (episodeChangingRef.current) {
      pendingEpisodeChangeRef.current = episodeNumber;
      return;
    }
    episodeChangingRef.current = true;
    try {
      let targetIndex: number | null = episodeNumber;
      while (targetIndex !== null) {
        const currentTarget = targetIndex;
        pendingEpisodeChangeRef.current = null;

        let currentDetail = detailRef.current;
        if (
          !currentDetail ||
          needsEpisodeHydration(currentDetail) ||
          !currentDetail.episodes ||
          currentTarget >= currentDetail.episodes.length
        ) {
          if (currentDetail?.source && currentDetail?.id) {
            const hydrated = await hydrateSearchResultEpisodesWithRetry(
              currentDetail,
              undefined,
              { force: true, attempts: 3 }
            );
            currentDetail = hydrated;
            if (hydrated.episodes?.length) {
              setDetail(hydrated);
              detailRef.current = hydrated;
              setAvailableSources((prev) =>
                prev.map((item) =>
                  String(item.source) === String(hydrated.source) &&
                  String(item.id) === String(hydrated.id)
                    ? hydrated
                    : item
                )
              );
              setCachedDetail(hydrated.source, hydrated.id, hydrated);
            }
          }
        }

        const finalTarget =
          pendingEpisodeChangeRef.current !== null
            ? pendingEpisodeChangeRef.current
            : currentTarget;
        pendingEpisodeChangeRef.current = null;

        const currentTotal = currentDetail?.episodes?.length || 0;
        const resolved = resolveLoadedEpisodeIndex(finalTarget, currentTotal);
        if (resolved.empty) {
          toast('無法取得此來源的播放清單', 'error');
        } else {
          // 手動切集要先取消倒數，否則倒數結束會把使用者拉回自動連播的目標集
          cancelAutoNextCountdown();
          // 在更換集數前儲存當前播放進度
          if (artPlayerRef.current) {
            saveCurrentPlayProgress();
          }
          lockResumeAndSetEpisode(resolved.index);
          replacePlaybackUrl({
            source: currentSourceRef.current,
            id: currentIdRef.current,
            title: getStableTitle(videoTitleRef.current, currentDetail?.title),
            year: videoYearRef.current || currentDetail?.year,
            episode: resolved.index + 1,
          });
          if (resolved.clamped) {
            toast(
              `此片源實際只有 ${currentTotal} 集，已切到第 ${resolved.index + 1} 集`,
              'info'
            );
          }
        }

        targetIndex = pendingEpisodeChangeRef.current;
      }
    } catch (e) {
      logger.error('切換集數失敗:', e);
      toast('切換集數失敗，請重試', 'error');
    } finally {
      episodeChangingRef.current = false;
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      cancelAutoNextCountdown();
      if (artPlayerRef.current) {
        saveCurrentPlayProgress();
      }
      lockResumeAndSetEpisode(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (!d?.episodes?.length) return;

    // 尚有下一集：直接切換
    if (idx < d.episodes.length - 1) {
      cancelAutoNextCountdown();
      if (artPlayerRef.current) {
        saveCurrentPlayProgress();
      }
      lockResumeAndSetEpisode(idx + 1);
      return;
    }

    // 已在最後一集：強制向詳情 API 確認是否有更新
    void handleCheckEpisodeUpdates();
  };

  const handleCheckEpisodeUpdates = () => {
    if (isCheckingEpisodes || episodeRefreshInFlightRef.current) return;
    // 手動檢查更新時可能正跑著「最後一集追更」的倒數；不取消的話 refresh 會
    // 推進一集、倒數結束又推進一集，等於跳過中間那集。
    cancelAutoNextCountdown();
    if (artPlayerRef.current) {
      saveCurrentPlayProgress();
    }
    setIsCheckingEpisodes(true);
    void refreshEpisodesIfNeeded({
      preferAdvanceOnGrowth: true,
      notifyWhenUnchanged: true,
      notifyOnGrowth: true,
    }).finally(() => {
      setIsCheckingEpisodes(false);
    });
  };

  // ---------------------------------------------------------------------------
  // 鍵盤快捷鍵
  // ---------------------------------------------------------------------------
  usePlayerKeyboardShortcuts({
    artPlayerRef,
    detailRef,
    currentEpisodeIndexRef,
    onPreviousEpisode: handlePreviousEpisode,
    onNextEpisode: handleNextEpisode,
    onToggleShortcutsHelp: () => setShowShortcuts((prev) => !prev),
  });

  // ---------------------------------------------------------------------------
  // 播放記錄相關
  // ---------------------------------------------------------------------------
  // 儲存播放進度
  const { lastSaveTimeRef, saveCurrentPlayProgress } = usePlayRecordPersistence(
    {
      artPlayerRef,
      currentSourceRef,
      currentIdRef,
      detailRef,
      currentEpisodeIndexRef,
      videoTitleRef,
      videoCoverRef,
      searchTitle,
      getCachedDetail,
      requestWakeLock,
      releaseWakeLock,
      cleanupPlayer,
    }
  );

  // 收藏邏輯已抽離到 useFavorite hook（見上方 state 宣告區）

  // 播放器建立 effect：頂部參數驗證與初始化失敗的同步 setError 為刻意的
  // 錯誤信號路徑，其餘 setState 皆在播放器事件回呼（非同步）中
  useEffect(() => {
    if (
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 搜尋列可能尚未帶集數，等詳情回來再初始化，避免對空陣列開 HLS。
    if (!detail || !detail.episodes || detail.episodes.length === 0) {
      return;
    }

    // 確保選集索引有效
    if (
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      // 播放器錯誤信號：effect 內偵測到無效選集時必須立即中止初始化並回報，
      // 無法改以 render 期推導（錯誤來自播放器生命週期而非 props）。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(`選集索引無效，當前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('影片地址無效');
      return;
    }

    // 同一個 URL：不要拆掉重建（背景 setDetail 等不應重啟 HLS）
    if (artPlayerRef.current && lastLoadedVideoUrlRef.current === videoUrl) {
      logger.debug('播放 URL 未變，略過播放器重建');
      return;
    }

    logger.debug('影片地址已解析');

    // 檢測是否為WebKit瀏覽器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof window.webkitConvertPointFromNodeToPage === 'function';

    // 非WebKit瀏覽器且播放器已存在，使用 switch 方法切換
    if (!isWebkit && artPlayerRef.current) {
      // v1.5.3: 直接 switch 不會重建 HLS，改用重建方式確保畫面正常
      const oldVideo = artPlayerRef.current.video;
      if (oldVideo && oldVideo.hls) {
        try {
          oldVideo.hls.destroy();
        } catch (err) {
          logger.warn('銷毀舊 hls 出錯:', err);
        }
      }
      try {
        artPlayerRef.current.destroy();
      } catch (err) {
        logger.warn('銷毀舊播放器出錯:', err);
      }
      artPlayerRef.current = null;
      // 跌入下方的重建邏輯
    }

    // WebKit瀏覽器或首次創建：銷燬之前的播放器實例並創建新的
    if (artPlayerRef.current) {
      cleanupPlayer();
    }

    try {
      let initialSavedRatio = 'default';
      let initialSavedOpacity = 'default';
      try {
        initialSavedRatio =
          localStorage.getItem('player_aspect_ratio') || 'default';
        initialSavedOpacity =
          localStorage.getItem('player_control_opacity') || 'default';
      } catch {
        // ignore
      }

      // 創建新的播放器實例
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = false;
      Artplayer.FULLSCREEN_WEB_IN_BODY = true;

      const skipSettings = buildSkipSettingsForPlayer();

      lastLoadedVideoUrlRef.current = videoUrl;
      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        poster: processImageUrl(videoCover),
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: !resumeTimeRef.current,
        pip: true,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        // 與站台 accent（tailwind accent / #00B4D8）對齊，避免播放器控制列粉紅脫節
        theme: '#00B4D8',
        lang: 'zh-tw',
        hotkey: false,
        // 長按 2x 改由 PlayerGestureLayer 處理，避免與 Artplayer 內建 3x 打架
        fastForward: false,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
        },
        // HLS 支援設定
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string) {
            if (!Hls) {
              logger.error('HLS.js 未載入');
              return;
            }

            if (video.hls) {
              video.hls.destroy();
            }
            const hlsBuffer = getVodHlsBufferConfig(
              typeof navigator !== 'undefined' &&
                isMobileUserAgent(navigator.userAgent)
            );
            const hls = new Hls({
              debug: false, // 關閉日誌
              enableWorker: true, // WebWorker 解碼，降低主線程壓力
              // 點播不要開 LL-HLS：低延遲模式容易造成音畫/字幕時間軸錯位
              lowLatencyMode: false,
              // 允許小幅緩衝空洞由播放器填補，減少 seek/去廣告後的 A/V drift
              maxBufferHole: 0.5,

              /* 緩衝/內存相關：手機更短，避免 80MB 把小機/手機 RAM 打滿 */
              maxBufferLength: hlsBuffer.maxBufferLength,
              backBufferLength: hlsBuffer.backBufferLength,
              maxBufferSize: hlsBuffer.maxBufferSize,
              appendTimeout: HLS_APPEND_TIMEOUT_MS,

              /* 自定義loader */
              loader: blockAdEnabledRef.current
                ? CustomHlsJsLoader
                : Hls.DefaultConfig.loader,
            });

            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls;

            ensureVideoSource(video, url);

            let networkRetries = 0;
            let mediaRetries = 0;
            let softNetworkFails = 0;
            hls.on(
              Hls.Events.ERROR,
              function (event: Events.ERROR, data: ErrorData) {
                const soft = tallySoftNetworkError(
                  data.fatal,
                  data.type,
                  data.details,
                  softNetworkFails
                );
                softNetworkFails = soft.count;
                if (
                  soft.escalate &&
                  shouldFallbackToVodProxy(
                    'networkError',
                    isVodHlsProxyUrl(videoUrl)
                  )
                ) {
                  const now = video.currentTime || 0;
                  const saved =
                    now > 3
                      ? now
                      : resumeTimeRef.current || lastGoodResumeRef.current;
                  if (typeof saved === 'number' && saved > 3) {
                    resumeTimeRef.current = saved;
                    lastGoodResumeRef.current = saved;
                  }
                  setVodProxySlot(playbackSlotKey);
                  return;
                }
                if (!data.fatal) {
                  logger.debug('HLS Error:', event, data);
                  return;
                }
                const { action, nextNetworkRetries, nextMediaRetries } =
                  nextHlsFatalAction(data.type, networkRetries, mediaRetries);
                networkRetries = nextNetworkRetries;
                mediaRetries = nextMediaRetries;
                if (action.type === 'startLoad') {
                  logger.debug('網路錯誤，嘗試恢復...');
                  const now = video.currentTime || 0;
                  const saved =
                    now > 3
                      ? now
                      : resumeTimeRef.current || lastGoodResumeRef.current;
                  if (typeof saved === 'number' && saved > 3) {
                    resumeTimeRef.current = saved;
                    lastGoodResumeRef.current = saved;
                  }
                  hls.startLoad();
                  return;
                }
                if (action.type === 'recoverMedia') {
                  logger.debug('媒體錯誤，嘗試恢復...');
                  hls.recoverMediaError();
                  return;
                }
                if (action.type === 'swapAudioCodec') {
                  logger.debug('媒體錯誤，嘗試切換音訊編碼...');
                  hls.swapAudioCodec();
                  hls.recoverMediaError();
                  return;
                }
                logger.debug('無法恢復的錯誤');
                if (
                  shouldFallbackToVodProxy(
                    data.type,
                    isVodHlsProxyUrl(videoUrl)
                  )
                ) {
                  const now = video.currentTime || 0;
                  const saved =
                    now > 3
                      ? now
                      : resumeTimeRef.current || lastGoodResumeRef.current;
                  if (typeof saved === 'number' && saved > 3) {
                    resumeTimeRef.current = saved;
                    lastGoodResumeRef.current = saved;
                  }
                  setVodProxySlot(playbackSlotKey);
                  return;
                }
                logger.error('無法恢復的致命錯誤，停止加載', data);
                hls.destroy();
                setIsVideoLoading(false);
                setPlaybackSoftError(action.message);
              }
            );
          },
        },
        icons: {
          loading:
            '<img aria-hidden="true" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        layers: [
          {
            name: 'topbar',
            html: `
              <div class="art-topbar flex items-center justify-between w-full px-5 py-3 text-white text-sm font-medium pointer-events-none select-none">
                <div class="art-topbar-title truncate max-w-[75%] drop-shadow text-white/95 font-semibold text-sm sm:text-base"></div>
                <div class="art-topbar-time tabular-nums text-xs opacity-90 drop-shadow bg-black/40 px-2.5 py-1 rounded-full border border-white/10 shrink-0 ml-2"></div>
              </div>
            `,
            style: {
              position: 'absolute',
              top: '0',
              left: '0',
              right: '0',
              zIndex: '20',
              pointerEvents: 'none',
              transition: 'opacity 0.3s ease, transform 0.3s ease',
              opacity: '0',
              transform: 'translateY(-10px)',
              background:
                'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0) 100%)',
            },
          },
        ],
        settings: [
          {
            html: '去廣告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabled ? '已開啟' : '已關閉',
            onClick() {
              const newVal = !blockAdEnabled;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                  if (
                    artPlayerRef.current.video &&
                    artPlayerRef.current.video.hls
                  ) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                }
                setBlockAdEnabled(newVal);
              } catch (_) {
                // ignore
              }
              return newVal ? '當前開啟' : '當前關閉';
            },
          },
          {
            html: '畫面比例',
            tooltip:
              initialSavedRatio === 'cover'
                ? '滿版裁切 (無黑邊)'
                : initialSavedRatio === 'fill'
                  ? '拉伸填滿'
                  : initialSavedRatio === '21:9'
                    ? '21:9 (超寬屏)'
                    : initialSavedRatio === '16:9'
                      ? '16:9'
                      : initialSavedRatio === '4:3'
                        ? '4:3'
                        : '預設 (自適應)',
            selector: [
              {
                html: '預設 (自適應)',
                value: 'default',
                default: initialSavedRatio === 'default',
              },
              {
                html: '16:9',
                value: '16:9',
                default: initialSavedRatio === '16:9',
              },
              {
                html: '21:9 (超寬屏)',
                value: '21:9',
                default: initialSavedRatio === '21:9',
              },
              {
                html: '4:3',
                value: '4:3',
                default: initialSavedRatio === '4:3',
              },
              {
                html: '滿版裁切 (無黑邊)',
                value: 'cover',
                default: initialSavedRatio === 'cover',
              },
              {
                html: '拉伸填滿',
                value: 'fill',
                default: initialSavedRatio === 'fill',
              },
            ],
            onSelect(item: { html: string; value: string }) {
              if (!artPlayerRef.current?.video) return item.html;
              const video = artPlayerRef.current.video;
              if (item.value === 'cover') {
                artPlayerRef.current.aspectRatio = 'default';
                video.style.objectFit = 'cover';
              } else if (item.value === 'fill') {
                artPlayerRef.current.aspectRatio = 'default';
                video.style.objectFit = 'fill';
              } else if (item.value === 'default') {
                artPlayerRef.current.aspectRatio = 'default';
                video.style.objectFit = 'contain';
              } else {
                artPlayerRef.current.aspectRatio = item.value;
                video.style.objectFit = 'contain';
              }
              try {
                localStorage.setItem('player_aspect_ratio', item.value);
              } catch {
                // ignore
              }
              return item.html;
            },
          },
          {
            html: '底欄透明度',
            tooltip:
              initialSavedOpacity === 'transparent'
                ? '全透明 (0%)'
                : initialSavedOpacity === 'half'
                  ? '半透明 (50%)'
                  : '預設漸變',
            selector: [
              {
                html: '預設漸變',
                value: 'default',
                default: initialSavedOpacity === 'default',
              },
              {
                html: '半透明 (50%)',
                value: 'half',
                default: initialSavedOpacity === 'half',
              },
              {
                html: '全透明 (0%)',
                value: 'transparent',
                default: initialSavedOpacity === 'transparent',
              },
            ],
            onSelect(item: { html: string; value: string }) {
              const bottomEl = artPlayerRef.current?.template?.$bottom;
              if (bottomEl) {
                if (item.value === 'transparent') {
                  bottomEl.style.background = 'transparent';
                } else if (item.value === 'half') {
                  bottomEl.style.background =
                    'linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 100%)';
                } else {
                  bottomEl.style.background = '';
                }
              }
              try {
                localStorage.setItem('player_control_opacity', item.value);
              } catch {
                // ignore
              }
              return item.html;
            },
          },
          skipSettings.skipToggle,
          {
            html: '刪除跳過設定',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return '';
            },
          },
          skipSettings.setIntro,
          skipSettings.setOutro,
        ],
        // 控製欄設定
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
        ],
      });

      let clockInterval: ReturnType<typeof setInterval> | null = null;
      const tickFullscreenClock = () => {
        if (!artPlayerRef.current) return;
        const isFs =
          artPlayerRef.current.fullscreen || artPlayerRef.current.fullscreenWeb;
        if (!isFs) return;
        const topbarLayer = artPlayerRef.current.layers.topbar;
        const timeEl = topbarLayer?.querySelector('.art-topbar-time');
        if (timeEl) {
          const now = new Date();
          const hh = String(now.getHours()).padStart(2, '0');
          const mm = String(now.getMinutes()).padStart(2, '0');
          timeEl.textContent = `${hh}:${mm}`;
        }
      };
      const startFullscreenClock = () => {
        if (clockInterval) return;
        tickFullscreenClock();
        clockInterval = setInterval(tickFullscreenClock, 1000);
      };
      const stopFullscreenClock = () => {
        if (!clockInterval) return;
        clearInterval(clockInterval);
        clockInterval = null;
      };
      const syncFullscreenClock = () => {
        const player = artPlayerRef.current;
        const isFs = Boolean(player?.fullscreen || player?.fullscreenWeb);
        if (isFs) startFullscreenClock();
        else stopFullscreenClock();
      };

      const applySavedPreferences = () => {
        try {
          const savedRatio = localStorage.getItem('player_aspect_ratio');
          if (savedRatio && artPlayerRef.current?.video) {
            const video = artPlayerRef.current.video;
            if (savedRatio === 'cover') {
              artPlayerRef.current.aspectRatio = 'default';
              video.style.objectFit = 'cover';
            } else if (savedRatio === 'fill') {
              artPlayerRef.current.aspectRatio = 'default';
              video.style.objectFit = 'fill';
            } else if (savedRatio !== 'default') {
              artPlayerRef.current.aspectRatio = savedRatio;
              video.style.objectFit = 'contain';
            }
          }
          const savedOpacity = localStorage.getItem('player_control_opacity');
          const bottomEl = artPlayerRef.current?.template?.$bottom;
          if (savedOpacity && bottomEl) {
            if (savedOpacity === 'transparent') {
              bottomEl.style.background = 'transparent';
            } else if (savedOpacity === 'half') {
              bottomEl.style.background =
                'linear-gradient(to top, rgba(0,0,0,0.4) 0%, transparent 100%)';
            }
          }
        } catch {
          // ignore
        }
      };

      const updateTopbar = (show: boolean) => {
        if (!artPlayerRef.current) return;
        const topbarLayer = artPlayerRef.current.layers.topbar;
        if (!topbarLayer) return;
        const isFs =
          artPlayerRef.current.fullscreen || artPlayerRef.current.fullscreenWeb;
        if (!isFs || !show) {
          topbarLayer.style.opacity = '0';
          topbarLayer.style.transform = 'translateY(-10px)';
          return;
        }
        const titleEl = topbarLayer.querySelector('.art-topbar-title');
        const timeEl = topbarLayer.querySelector('.art-topbar-time');
        const displayTitle = getStableTitle(
          videoTitleRef.current,
          detailRef.current?.title
        );
        const epIdx = currentEpisodeIndexRef.current;
        const epTitle = detailRef.current?.episodes_titles?.[epIdx];
        const total = detailRef.current?.episodes?.length || totalEpisodes;
        const epText = epTitle || (total > 1 ? `第 ${epIdx + 1} 集` : '');
        if (titleEl) {
          titleEl.textContent = epText
            ? `${displayTitle} · ${epText}`
            : displayTitle;
        }
        if (timeEl) {
          const now = new Date();
          const hh = String(now.getHours()).padStart(2, '0');
          const mm = String(now.getMinutes()).padStart(2, '0');
          timeEl.textContent = `${hh}:${mm}`;
        }
        topbarLayer.style.opacity = '1';
        topbarLayer.style.transform = 'translateY(0)';
      };

      // 監聽播放器事件
      artPlayerRef.current.on('ready', () => {
        setError(null);
        applySavedPreferences();

        // 播放器就緒後，如果正在播放則請求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      });

      artPlayerRef.current.on('destroy', () => {
        stopFullscreenClock();
      });

      artPlayerRef.current.on('control', (state: boolean) => {
        updateTopbar(state);
        applySavedPreferences();
      });
      artPlayerRef.current.on('fullscreen', (state: boolean) => {
        syncFullscreenClock();
        updateTopbar(state);
        applySavedPreferences();
      });
      artPlayerRef.current.on('fullscreenWeb', (state: boolean) => {
        syncFullscreenClock();
        updateTopbar(state);
        applySavedPreferences();
      });
      syncFullscreenClock();

      // 監聽播放狀態變化，控製 Wake Lock
      artPlayerRef.current.on('play', () => {
        requestWakeLock();
      });

      artPlayerRef.current.on('pause', () => {
        releaseWakeLock();
        saveCurrentPlayProgress();
      });

      // 如果播放器初始化時已經在播放狀態，則請求 Wake Lock
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        requestWakeLock();
      }

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });
      artPlayerRef.current.on('video:ratechange', () => {
        if ((artPlayerRef.current as { holdSpeed?: boolean }).holdSpeed) {
          return;
        }
        const currentRate = artPlayerRef.current.playbackRate;
        lastPlaybackRateRef.current = currentRate;
        try {
          localStorage.setItem('playbackRate', String(currentRate));
        } catch {
          // ignore quota errors
        }
      });
      const onPiPChange = () => {
        setIsPiP(!!document.pictureInPictureElement);
      };
      const pipVideoEl = artPlayerRef.current?.video;
      if (pipVideoEl) {
        pipVideoEl.addEventListener('enterpictureinpicture', onPiPChange);
        pipVideoEl.addEventListener('leavepictureinpicture', onPiPChange);
      }

      const tryApplyResumeTime = () => {
        const player = artPlayerRef.current;
        const target = resumeTimeRef.current;
        if (!player || !target || target <= 0) return;
        try {
          const outcome = applyResumeToPlayer(player, target);
          if (outcome === 'done') {
            resumeTimeRef.current = null;
            return;
          }
          if (outcome === 'seek') {
            logger.debug('成功恢復播放進度到:', target);
            setTimeout(() => {
              try {
                artPlayerRef.current?.play();
              } catch {
                // 自動播放可能被瀏覽器擋，忽略
              }
            }, 100);
          }
        } catch (err) {
          logger.warn('恢復播放進度失敗:', err);
        }
      };

      // 監聽影片可播放事件，這時恢復播放進度更可靠。
      // duration 還沒穩定時不要清掉 resumeTimeRef，否則 HLS 重試後無法再 seek。
      artPlayerRef.current.on('video:canplay', () => {
        tryApplyResumeTime();

        setTimeout(() => {
          const currentPlayer = artPlayerRef.current;
          if (!currentPlayer) return;
          if (Math.abs(currentPlayer.volume - lastVolumeRef.current) > 0.01) {
            currentPlayer.volume = lastVolumeRef.current;
          }
          if (
            Math.abs(currentPlayer.playbackRate - lastPlaybackRateRef.current) >
            0.01
          ) {
            currentPlayer.playbackRate = lastPlaybackRateRef.current;
          }
          currentPlayer.notice.show = '';
        }, 0);

        // 隱藏換源載入狀態
        setIsVideoLoading(false);
      });

      artPlayerRef.current.on('video:loadedmetadata', () => {
        tryApplyResumeTime();
      });
      artPlayerRef.current.on('video:durationchange', () => {
        tryApplyResumeTime();
      });

      // 監聽影片時間更新事件，實現跳過片頭片尾按鈕顯示
      artPlayerRef.current.on('video:timeupdate', () => {
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          tryApplyResumeTime();
        }
        if (!skipConfigRef.current.enable) {
          if (showSkipIntroRef.current) {
            showSkipIntroRef.current = false;
            setShowSkipIntro(false);
          }
          if (showSkipOutroRef.current) {
            showSkipOutroRef.current = false;
            setShowSkipOutro(false);
          }
          return;
        }

        const currentTime = artPlayerRef.current.currentTime || 0;
        const duration = artPlayerRef.current.duration || 0;

        // 跳過片頭按鈕顯示邏輯
        if (skipConfigRef.current.intro_time > 0) {
          if (
            currentTime > 0 &&
            currentTime < skipConfigRef.current.intro_time
          ) {
            if (!showSkipIntroRef.current) {
              showSkipIntroRef.current = true;
              setShowSkipIntro(true);
            }
          } else if (showSkipIntroRef.current) {
            showSkipIntroRef.current = false;
            setShowSkipIntro(false);
          }
        } else if (showSkipIntroRef.current) {
          showSkipIntroRef.current = false;
          setShowSkipIntro(false);
        }

        // 跳過片尾按鈕顯示邏輯
        if (skipConfigRef.current.outro_time < 0 && duration > 0) {
          const outroStart = duration + skipConfigRef.current.outro_time; // outro_time is negative
          if (currentTime >= outroStart && currentTime < duration - 1) {
            if (!showSkipOutroRef.current) {
              showSkipOutroRef.current = true;
              setShowSkipOutro(true);
            }
          } else if (showSkipOutroRef.current) {
            showSkipOutroRef.current = false;
            setShowSkipOutro(false);
          }
        } else if (showSkipOutroRef.current) {
          showSkipOutroRef.current = false;
          setShowSkipOutro(false);
        }
      });

      artPlayerRef.current.on('error', (err: any) => {
        logger.error('播放器錯誤:', err);
        if (artPlayerRef.current.currentTime > 0) {
          return;
        }
        if (
          currentSourceRef.current &&
          shouldFallbackToVodProxy('networkError', isVodHlsProxyUrl(videoUrl))
        ) {
          setVodProxySlot(playbackSlotKey);
          return;
        }
        const source = currentSourceRef.current;
        const id = currentIdRef.current;
        const episodeIndex = currentEpisodeIndexRef.current;
        const retryKey = `${source}_${id}_${episodeIndex}`;
        if (!source || !id || detailRetryKeyRef.current === retryKey) {
          return;
        }
        detailRetryKeyRef.current = retryKey;

        void (async () => {
          try {
            clearCachedDetail(source, id);
            const params = new URLSearchParams({ source, id });
            const response = await fetch(`/api/detail?${params.toString()}`, {
              cache: 'no-store',
            });
            if (!response.ok) {
              throw new Error(`detail refresh failed: ${response.status}`);
            }
            const freshDetail = (await response.json()) as SearchResult;
            if (
              currentSourceRef.current !== source ||
              currentIdRef.current !== id ||
              currentEpisodeIndexRef.current !== episodeIndex
            ) {
              return;
            }
            const merged = mergeFreshDetail(
              detailRef.current,
              freshDetail,
              episodeIndex,
              { preserveCurrentEpisodeUrl: false }
            );
            if (!merged.applied || !merged.detail) return;
            setCachedDetail(source, id, merged.detail);
            setDetail(merged.detail);
            setVideoYear(merged.detail.year);
            setVideoTitle(
              getStableTitle(merged.detail.title, videoTitleRef.current)
            );
            setVideoCover(merged.detail.poster);
            setVideoDoubanId(merged.detail.douban_id || 0);
            if (merged.episodeIndex !== episodeIndex) {
              setCurrentEpisodeIndex(merged.episodeIndex);
            }
            // videoUrl 為推導值，隨 setDetail / setCurrentEpisodeIndex 自動更新
            logger.info('播放錯誤後已清除詳情快取並重新抓取');
          } catch (refreshErr) {
            logger.error('播放錯誤後重新抓取詳情失敗:', refreshErr);
          }
        })();
      });

      artPlayerRef.current.on('video:ended', () => {
        releaseWakeLock();
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (autoNextBusyRef.current) return;
        if (
          d &&
          d.episodes &&
          idx < d.episodes.length - 1 &&
          autoNextRef.current
        ) {
          startAutoNextCountdown();
          return;
        }

        // 已在最後一集且開啟自動連播：再查一次是否有新集
        if (
          d &&
          d.episodes &&
          idx >= d.episodes.length - 1 &&
          autoNextRef.current
        ) {
          void (async () => {
            // 先只更新集數列表，不立刻切集，避免播放器閃爍
            const result = await refreshEpisodesIfNeededRef.current?.({
              preferAdvanceOnGrowth: false,
              notifyWhenUnchanged: false,
              notifyOnGrowth: true,
            });
            if (!result) return;
            if (!result.updated) return;
            if (autoNextBusyRef.current) return;

            const latest = detailRef.current;
            const currentIdx = currentEpisodeIndexRef.current;
            if (!latest?.episodes || currentIdx >= latest.episodes.length - 1) {
              return;
            }

            startAutoNextCountdown();
          })();
        }
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        const now = Date.now();
        let interval = 5000;
        if (getClientStorageType() === 'upstash') {
          interval = 20000;
        }
        // 只有實際觸發存檔才更新時間戳（如果 saveLock 封鎖了則不更新）
        if (now - lastSaveTimeRef.current > interval) {
          saveCurrentPlayProgress();
          // lastSaveTimeRef 在 saveCurrentPlayProgress 內部更新
        }
      });

      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl
        );
      }
    } catch (err) {
      logger.error('創建播放器失敗:', err);
      setError('播放器初始化失敗');
    }
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled, playerReloadToken]);

  // P 鍵切換子母畫面。
  // 這個監聽必須獨立於播放器建立 effect：後者的依賴含 videoUrl，每換一集就重跑
  // 一次，而它沒有（也不該有）移除 document 監聽的 cleanup——過去每換一集就會
  // 多疊一個 handler，按 P 時多個 handler 依序進出 PiP，看起來像完全沒反應。
  // 這裡只透過 ref 存取播放器，因此掛載一次即可。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'p' || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (
        active?.tagName === 'INPUT' ||
        active?.tagName === 'TEXTAREA' ||
        active?.isContentEditable
      ) {
        return;
      }
      void (async () => {
        try {
          if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
            setIsPiP(false);
          } else if (artPlayerRef.current?.video) {
            await artPlayerRef.current.video.requestPictureInPicture();
            setIsPiP(true);
          }
        } catch {
          setIsPiP(false);
        }
      })();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // 當組件解除安裝時清理定時器、Wake Lock 和播放器資源
  useEffect(() => {
    return () => {
      // v1.5.3: 卸載前儲存播放進度

      saveCurrentPlayProgress();

      releaseWakeLock();

      // cleanupPlayer 內部會一併中止自動連播倒數
      cleanupPlayer(false);
    };
  }, []);

  if (loading) {
    return (
      <PlayLoadingView
        loadingStage={loadingStage}
        loadingMessage={loadingMessage}
      />
    );
  }

  if (error) {
    return <PlayErrorView error={error} videoTitle={videoTitle} />;
  }

  return (
    <PageLayout activePath='/play'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 第一行：影片標題 + 集數徽章（避免「片名 > 4」難讀） */}
        <div className='py-1 flex flex-wrap items-center gap-2 min-w-0 pr-16 md:pr-24'>
          <h1
            className='text-lg sm:text-xl font-semibold text-zinc-100 min-w-0 truncate'
            title={videoTitle || '影片標題'}
          >
            {videoTitle || '影片標題'}
          </h1>
          {totalEpisodes > 1 && (
            <span className='shrink-0 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs sm:text-sm font-semibold text-accent tabular-nums'>
              {formatEpisodeBadge(
                detail?.episodes_titles?.[currentEpisodeIndex],
                currentEpisodeIndex
              )}
            </span>
          )}
        </div>
        {/* 第二行：播放器和選集 */}
        <div className='space-y-2'>
          {/* 摺疊控製 - 僅在 lg 及以上熒幕顯示 */}
          <EpisodeCollapseToggle
            collapsed={isEpisodeSelectorCollapsed}
            onToggle={() =>
              setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
            }
          />

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            {/* 播放器 */}
            <div
              className={`h-full transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${
                isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-[300px] lg:h-full group'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                ></div>

                {/* 觸控手勢處理層 */}
                {!isVideoLoading && (
                  <PlayerGestureLayer
                    artRef={artPlayerRef}
                    containerRef={artRef}
                  />
                )}

                {/* 跳過片頭按鈕 */}
                {showSkipIntro && (
                  <SkipButton
                    label='跳過片頭'
                    onClick={() => {
                      if (artPlayerRef.current) {
                        artPlayerRef.current.currentTime =
                          skipConfigRef.current.intro_time;
                        artPlayerRef.current.notice.show = `已跳過片頭 (${formatPlayerTime(
                          skipConfigRef.current.intro_time
                        )})`;
                      }
                    }}
                  />
                )}

                {/* 跳過片尾按鈕 */}
                {showSkipOutro && (
                  <SkipButton
                    label='跳過片尾'
                    onClick={() => {
                      if (artPlayerRef.current) {
                        const d = detailRef.current;
                        const idx = currentEpisodeIndexRef.current;
                        if (d && d.episodes && idx < d.episodes.length - 1) {
                          setCurrentEpisodeIndex(idx + 1);
                        } else {
                          artPlayerRef.current.currentTime =
                            (artPlayerRef.current.duration || 1) - 0.1;
                          artPlayerRef.current.pause();
                        }
                        artPlayerRef.current.notice.show = `已跳過片尾 (${formatPlayerTime(
                          Math.abs(skipConfigRef.current.outro_time)
                        )})`;
                      }
                    }}
                  />
                )}

                {/* 換源載入蒙層 */}
                {isVideoLoading && (
                  <VideoLoadingOverlay stage={videoLoadingStage} />
                )}

                {/* 全螢幕時仍看得到集數 */}
                {!isVideoLoading && !playbackSoftError && totalEpisodes > 1 && (
                  <PlayerEpisodeBadge
                    label={formatEpisodeBadge(
                      detail?.episodes_titles?.[currentEpisodeIndex],
                      currentEpisodeIndex
                    )}
                  />
                )}

                {playbackSoftError && (
                  <PlaybackSoftErrorOverlay
                    message={playbackSoftError}
                    onRetry={() => {
                      setPlaybackSoftError(null);
                      setVodProxySlot(null);
                      lastLoadedVideoUrlRef.current = '';
                      setPlayerReloadToken((token) => token + 1);
                    }}
                    onAutoSwitch={
                      pickNextPreferredSource(availableSources, {
                        currentSource,
                        currentId,
                        getInfo: (key) => precomputedVideoInfo.get(key),
                      })
                        ? () => {
                            const next = pickNextPreferredSource(
                              availableSources,
                              {
                                currentSource,
                                currentId,
                                getInfo: (key) => precomputedVideoInfo.get(key),
                              }
                            );
                            if (!next?.source || !next.id) return;
                            setPlaybackSoftError(null);
                            void handleSourceChange(
                              String(next.source),
                              String(next.id),
                              next.title || videoTitle
                            );
                          }
                        : undefined
                    }
                    autoSwitchLabel={(() => {
                      const next = pickNextPreferredSource(availableSources, {
                        currentSource,
                        currentId,
                        getInfo: (key) => precomputedVideoInfo.get(key),
                      });
                      if (!next) return undefined;
                      const info = precomputedVideoInfo.get(
                        `${next.source}-${next.id}`
                      );
                      return info && isPreferredDisplayQuality(info.quality)
                        ? '自動切換至下一個 1080p 來源'
                        : '自動切換至下一個可用來源';
                    })()}
                    onBrowseSources={() => {
                      setPlaybackSoftError(null);
                      setIsEpisodeSelectorCollapsed(false);
                      requestAnimationFrame(() => {
                        document
                          .getElementById('play-source-panel')
                          ?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'nearest',
                          });
                      });
                    }}
                    onDismiss={() => setPlaybackSoftError(null)}
                  />
                )}

                {/* 自動連播倒數計時蒙層 */}
                {showCountdownOverlay && autoNextCountdown > 0 && (
                  <AutoNextCountdownOverlay
                    countdown={autoNextCountdown}
                    onPlayNow={() => {
                      cancelAutoNextCountdown();
                      playNextEpisodeFromCountdown();
                    }}
                    onCancel={() => {
                      cancelAutoNextCountdown();
                    }}
                  />
                )}
              </div>
            </div>

            {/* 選集和換源 - 在移動端始終顯示，在 lg 及以上可摺疊 */}
            <div
              id='play-source-panel'
              className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
                isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                episodes_titles={detail?.episodes_titles || []}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
                preferSourcesTab={Boolean(playbackSoftError)}
                onSourceHydrated={(hydrated) => {
                  setAvailableSources((prev) =>
                    prev.map((item) =>
                      String(item.source) === String(hydrated.source) &&
                      String(item.id) === String(hydrated.id)
                        ? hydrated
                        : item
                    )
                  );
                  setCachedDetail(hydrated.source, hydrated.id, hydrated);
                  if (
                    String(hydrated.source) ===
                      String(currentSourceRef.current) &&
                    String(hydrated.id) === String(currentIdRef.current) &&
                    hydrated.episodes?.length
                  ) {
                    setDetail(hydrated);
                    detailRef.current = hydrated;
                  }
                }}
              />
              {/* 自動連播 + 快捷鍵幫助 */}
              <div className='flex items-center gap-3 px-3 py-2.5 mt-2 bg-black/40 dark:bg-white/5 rounded-lg border border-white/5'>
                {totalEpisodes > 0 &&
                  currentEpisodeIndex >= totalEpisodes - 1 && (
                    <button
                      type='button'
                      disabled={isCheckingEpisodes}
                      onClick={handleCheckEpisodeUpdates}
                      className='text-xs px-2.5 py-1.5 rounded-md bg-zinc-700/80 text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 shrink-0'
                      title='向片源重新抓取最新集數'
                    >
                      {isCheckingEpisodes ? '檢查中…' : '檢查更新'}
                    </button>
                  )}
                <div className='flex items-center gap-2 min-w-0'>
                  <span className='text-xs text-zinc-400 shrink-0'>
                    自動連播
                  </span>
                  <button
                    type='button'
                    role='switch'
                    aria-checked={autoNext}
                    aria-label='自動連播'
                    onClick={() => {
                      const newVal = !autoNext;
                      setAutoNext(newVal);
                      localStorage.setItem('enable_autonext', String(newVal));
                    }}
                    className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                      autoNext ? 'bg-accent' : 'bg-zinc-600'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        autoNext ? 'translate-x-4' : ''
                      }`}
                    />
                  </button>
                </div>
                <button
                  type='button'
                  onClick={() => setShowShortcuts(!showShortcuts)}
                  className='ml-auto text-xs font-medium text-zinc-400 hover:text-white transition-colors shrink-0 px-1 py-1'
                >
                  快捷鍵
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 快捷鍵幫助面板 */}
        {showShortcuts && (
          <ShortcutsHelpPanel onClose={() => setShowShortcuts(false)} />
        )}

        {/* 詳情展示 */}
        <VideoDetailsPanel
          detail={detail}
          videoTitle={videoTitle}
          videoYear={videoYear}
          videoCover={videoCover}
          videoDoubanId={videoDoubanId}
          favorited={favorited}
          onToggleFavorite={handleToggleFavorite}
        />
      </div>
    </PageLayout>
  );
}

function PlayPageKeyed() {
  const searchParams = useSearchParams();
  const source = searchParams.get('source') ?? '';
  const id = searchParams.get('id') ?? '';
  const title = searchParams.get('title') ?? '';
  return <PlayPageClient key={getPlayPageRemountKey(source, id, title)} />;
}

export default function PlayPage() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoading />}>
        <PlayPageKeyed />
      </Suspense>
    </ErrorBoundary>
  );
}
