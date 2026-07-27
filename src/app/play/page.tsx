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
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  type PlayRecord,
  saveSkipConfig,
} from '@/lib/db.client';
import { logger } from '@/lib/logger';
import { formatPlayerTime, getStableTitle } from '@/lib/play-page-utils';
import {
  buildPlaybackSearchPlan,
  deduplicateResults,
  fetchBangumiSearchAliases,
  PlaybackSearchPlanStage,
} from '@/lib/play-search';
import { isFuzzyMatch } from '@/lib/searchEngine';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';
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
import {
  clearCachedDetail,
  DEFAULT_SKIP_CONFIG,
  formatEpisodeUpdateMessage,
  getCachedDetail,
  getClientStorageType,
  mergeDetailPreservingPlayback,
  mergeFreshDetail,
  migrateDetailCache,
  setCachedDetail,
} from './play-page-helpers';
import { PlayErrorView, PlayLoadingView } from './play-views';
import { buildSkipSettings } from './player-skip-settings';
import {
  AutoNextCountdownOverlay,
  EpisodeCollapseToggle,
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

  // 自動連播倒數計時
  const [autoNextCountdown, setAutoNextCountdown] = useState(0);
  const [showCountdownOverlay, setShowCountdownOverlay] = useState(false);
  const [isCheckingEpisodes, setIsCheckingEpisodes] = useState(false);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  // 集數相關
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

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
  const skipHistoryRestoreRef = useRef(false);
  const autoNextBusyRef = useRef(false);
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
  const videoUrl = detail?.episodes?.[currentEpisodeIndex] || '';
  const totalEpisodes = detail?.episodes?.length || 0;
  const resumeTimeRef = useRef<number | null>(null);
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
    const newUrl = new URL(window.location.href);
    Object.entries(updates).forEach(([key, value]) => {
      const nextValue = value === undefined || value === null ? '' : `${value}`;
      if (!nextValue || nextValue === 'undefined' || nextValue === 'null') {
        newUrl.searchParams.delete(key);
      } else {
        newUrl.searchParams.set(key, nextValue);
      }
    });
    removeKeys.forEach((key) => newUrl.searchParams.delete(key));
    window.history.replaceState({}, '', newUrl.toString());
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除舊的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始終允許遠程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾經有禁用屬性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  /**
   * 中止自動連播倒數。
   * 使用者在倒數期間手動切集時務必呼叫，否則倒數結束仍會強制跳到「倒數開始那一刻
   * 的下一集」，把人從剛選的集數拉走。
   */
  const cancelAutoNextCountdown = (resetUi = true) => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (resetUi) {
      setShowCountdownOverlay(false);
      setAutoNextCountdown(0);
    }
    autoNextBusyRef.current = false;
  };

  const playNextEpisodeFromCountdown = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d?.episodes && idx < d.episodes.length - 1) {
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  /**
   * 啟動自動連播倒數。切集時才讀取當下的集數索引——不可沿用倒數開始時捕獲的值，
   * 否則使用者在這 5 秒內手動換集會被拉回去。
   */
  const startAutoNextCountdown = () => {
    autoNextBusyRef.current = true;
    let remaining = 5;
    setAutoNextCountdown(remaining);
    setShowCountdownOverlay(true);
    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setAutoNextCountdown(remaining);
        return;
      }

      cancelAutoNextCountdown();
      playNextEpisodeFromCountdown();
    }, 1000);
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

  // 跳過片頭片尾設定相關函數
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);
      skipConfigRef.current = newConfig;
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
        if (artPlayerRef.current) {
          const { skipToggle, setIntro, setOutro } =
            buildSkipSettingsForPlayer();
          artPlayerRef.current.setting.update(skipToggle);
          artPlayerRef.current.setting.update(setIntro);
          artPlayerRef.current.setting.update(setOutro);
        }
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }
      logger.debug('跳過片頭片尾設定已儲存:', newConfig);
    } catch (err) {
      logger.error('儲存跳過片頭片尾設定失敗:', err);
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
          const cachedDetail = getCachedDetail(currentSource, currentId);
          if (cachedDetail) {
            logger.debug(
              'Cache hit for direct load detail:',
              cachedDetail.title
            );
            detailData = cachedDetail;
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
            }
          }
        }

        if (!detailData) {
          const searchedQueries = new Set<string>();
          const searchQueries = async (
            queries: string[],
            searchOptions: {
              speedTest?: boolean;
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
                  speedTest: searchOptions.speedTest,
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
                speedTest: stage.speedTest,
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
              const detail = currentDetailList[0];
              if (
                isFuzzyMatch(detail.title, initialVideoTitleRef.current) ||
                (searchTitle ? isFuzzyMatch(detail.title, searchTitle) : false)
              ) {
                sourcesInfo = [...currentDetailList, ...sourcesInfo];
              }
            }
          }
        }

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
                detailData = await preferBestSource(sourcesInfo);
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
            setLoadingMessage('⚡ 正在優選最佳播放源...');

            detailData = await preferBestSource(sourcesInfo);
            if (!active) return;
          }
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
              // 雙重保險：播放 URL 變了就不套用
              const idx = currentEpisodeIndexRef.current;
              const prevUrl = prevDetail?.episodes?.[idx] || '';
              const nextUrl = again.detail.episodes?.[idx] || '';
              if (prevUrl && nextUrl && prevUrl !== nextUrl) {
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
                    speedTest: backgroundStage?.speedTest,
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

              if (
                !bgSourcesInfo.some(
                  (source) =>
                    source.source === currentDetail.source &&
                    source.id === currentDetail.id
                )
              ) {
                if (
                  isFuzzyMatch(
                    currentDetail.title,
                    initialVideoTitleRef.current
                  ) ||
                  (searchTitle
                    ? isFuzzyMatch(currentDetail.title, searchTitle)
                    : false)
                ) {
                  bgSourcesInfo = [currentDetail, ...bgSourcesInfo];
                }
              } else {
                const idx = bgSourcesInfo.findIndex(
                  (source) =>
                    source.source === currentDetail.source &&
                    source.id === currentDetail.id
                );
                if (idx !== -1) {
                  bgSourcesInfo[idx] = currentDetail;
                }
              }
              setAvailableSources(bgSourcesInfo);
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

    const initFromHistory = async () => {
      if (skipHistoryRestoreRef.current) {
        skipHistoryRestoreRef.current = false;
        return;
      }
      try {
        const allRecords = await getAllPlayRecords();
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

        const epParam = searchParams.get('episode');
        let targetIndex = -1;
        let targetTime = 0;

        if (epParam) {
          const epNum = parseInt(epParam, 10);
          if (!isNaN(epNum) && epNum > 0) {
            targetIndex = epNum - 1;
            // 如果歷史記錄的集數與 URL 指定的集數一致，則恢復播放進度時間
            const recordIndex =
              record && typeof record.index === 'number' ? record.index : 1;
            const oneBasedRecordIndex = recordIndex <= 0 ? 1 : recordIndex;
            if (oneBasedRecordIndex === epNum && record) {
              targetTime = record.play_time || 0;
            }
          }
        }

        // 如果 URL 中沒有指定集數，則回退使用播放歷史中的集數和進度
        if (targetIndex === -1 && record) {
          const rawIndex = typeof record.index === 'number' ? record.index : 1;
          const oneBasedIndex = rawIndex <= 0 ? 1 : rawIndex;
          targetIndex = Math.max(0, oneBasedIndex - 1);
          targetTime = record.play_time || 0;
        }

        if (targetIndex !== -1 && !cancelled) {
          // 同步更新 ref 以避免 timeupdate 在 state 生效前用舊值存檔
          currentEpisodeIndexRef.current = targetIndex;
          setCurrentEpisodeIndex(targetIndex);

          // 儲存待恢復的播放進度，待播放器就緒後跳轉
          if (targetTime > 3) {
            resumeTimeRef.current = targetTime;
          } else {
            resumeTimeRef.current = 0;
          }
        }
      } catch (err) {
        logger.error('讀取播放記錄失敗:', err);
      }
    };

    initFromHistory();

    return () => {
      cancelled = true;
    };
  }, [currentSource, currentId]);

  // 跳過片頭片尾設定處理
  useEffect(() => {
    let cancelled = false;

    // 僅在初次掛載時檢查跳過片頭片尾設定
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      setSkipConfig(DEFAULT_SKIP_CONFIG);
      skipConfigRef.current = DEFAULT_SKIP_CONFIG;

      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (cancelled) return;
        const nextConfig = config || DEFAULT_SKIP_CONFIG;
        setSkipConfig(nextConfig);
        skipConfigRef.current = nextConfig;
      } catch (err) {
        logger.error('讀取跳過片頭片尾設定失敗:', err);
      }
    };

    initSkipConfig();

    return () => {
      cancelled = true;
    };
  }, [currentSource, currentId]);

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

      // 清除前一個歷史記錄
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current,
            {
              title: getStableTitle(
                videoTitleRef.current,
                detailRef.current?.title
              ),
              source_name: detailRef.current?.source_name || '',
            }
          );
          logger.debug('已清除前一個播放記錄');
        } catch (err) {
          logger.error('清除播放記錄失敗:', err);
        }
      }

      if (!isLatestRequest()) return;

      const newDetail = targetDetail;

      setCachedDetail(newSource, newId, newDetail);

      // 嘗試跳轉到當前正在播放的集數
      let targetIndex = currentEpisodeIndex;

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
            const idx = currentEpisodeIndexRef.current;
            const prevUrl = prevDetail?.episodes?.[idx] || '';
            const nextUrl = again.detail.episodes?.[idx] || '';
            if (prevUrl && nextUrl && prevUrl !== nextUrl) {
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
  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      // 手動切集要先取消倒數，否則倒數結束會把使用者拉回自動連播的目標集
      cancelAutoNextCountdown();
      // 在更換集數前儲存當前播放進度
      if (artPlayerRef.current) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(episodeNumber);
      const currentDetail = detailRef.current;
      replacePlaybackUrl({
        source: currentSourceRef.current,
        id: currentIdRef.current,
        title: getStableTitle(videoTitleRef.current, currentDetail?.title),
        year: videoYearRef.current || currentDetail?.year,
        episode: episodeNumber + 1,
      });
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
      setCurrentEpisodeIndex(idx - 1);
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
      setCurrentEpisodeIndex(idx + 1);
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

    // 確保選集索引有效
    if (
      !detail ||
      !detail.episodes ||
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
        theme: '#ff3e6c',
        lang: 'zh-cn',
        hotkey: false,
        fastForward: true,
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
            const hls = new Hls({
              debug: false, // 關閉日誌
              enableWorker: true, // WebWorker 解碼，降低主線程壓力
              // 點播不要開 LL-HLS：低延遲模式容易造成音畫/字幕時間軸錯位
              lowLatencyMode: false,
              // 允許小幅緩衝空洞由播放器填補，減少 seek/去廣告後的 A/V drift
              maxBufferHole: 0.5,

              /* 緩衝/內存相關 */
              maxBufferLength: 60,
              backBufferLength: 30,
              maxBufferSize: 80 * 1000 * 1000,

              /* 自定義loader */
              loader: blockAdEnabledRef.current
                ? CustomHlsJsLoader
                : Hls.DefaultConfig.loader,
            });

            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls;

            ensureVideoSource(video, url);

            hls.on(
              Hls.Events.ERROR,
              function (event: Events.ERROR, data: ErrorData) {
                logger.error('HLS Error:', event, data);
                if (data.fatal) {
                  switch (data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                      logger.debug('網路錯誤，嘗試恢復...');
                      hls.startLoad();
                      break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                      logger.debug('媒體錯誤，嘗試恢復...');
                      hls.recoverMediaError();
                      break;
                    default:
                      logger.debug('無法恢復的錯誤');
                      hls.destroy();
                      setIsVideoLoading(false);
                      setError('播放失敗，請嘗試換源或重新整理');
                      break;
                  }
                }
              }
            );
          },
        },
        icons: {
          loading:
            '<img aria-hidden="true" src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
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

      // 監聽播放器事件
      artPlayerRef.current.on('ready', () => {
        setError(null);

        // 播放器就緒後，如果正在播放則請求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      });

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

      // 監聽影片可播放事件，這時恢復播放進度更可靠
      artPlayerRef.current.on('video:canplay', () => {
        const player = artPlayerRef.current;
        if (!player) return;
        // 若存在需要恢復的播放進度，則跳轉
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = player.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            player.currentTime = target;
            logger.debug('成功恢復播放進度到:', resumeTimeRef.current);
            // seek 完成後手動恢復播放（autoplay 已關閉避免 0:00 閃爍）
            setTimeout(() => {
              try {
                artPlayerRef.current?.play();
              } catch {
                // 自動播放可能被瀏覽器擋，忽略
              }
            }, 100);
          } catch (err) {
            logger.warn('恢復播放進度失敗:', err);
          }
        }
        resumeTimeRef.current = null;

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

      // 監聽影片時間更新事件，實現跳過片頭片尾按鈕顯示
      artPlayerRef.current.on('video:timeupdate', () => {
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
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled]);

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
        {/* 第一行：影片標題 */}
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100'>
            {videoTitle || '影片標題'}
            {totalEpisodes > 1 && (
              <span className='text-zinc-700 dark:text-zinc-300'>
                {` > ${
                  detail?.episodes_titles?.[currentEpisodeIndex] ||
                  `第 ${currentEpisodeIndex + 1} 集`
                }`}
              </span>
            )}
          </h1>
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
                          skipConfigRef.current.outro_time
                        )})`;
                      }
                    }}
                  />
                )}

                {/* 換源載入蒙層 */}
                {isVideoLoading && (
                  <VideoLoadingOverlay stage={videoLoadingStage} />
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
              />
              {/* 自動連播 + 快捷鍵幫助 */}
              <div className='flex items-center justify-between px-3 py-2 mt-2 bg-black/40 dark:bg-white/5 rounded-lg border border-white/5'>
                {totalEpisodes > 0 &&
                  currentEpisodeIndex >= totalEpisodes - 1 && (
                    <button
                      type='button'
                      disabled={isCheckingEpisodes}
                      onClick={handleCheckEpisodeUpdates}
                      className='text-xs px-2 py-1 rounded bg-zinc-700/80 text-zinc-200 hover:bg-zinc-600 disabled:opacity-50'
                      title='向片源重新抓取最新集數'
                    >
                      {isCheckingEpisodes ? '檢查中…' : '檢查更新'}
                    </button>
                  )}
                <label className='flex items-center gap-2 cursor-pointer select-none'>
                  <span className='text-xs text-zinc-400'>自動連播</span>
                  <div
                    className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
                      autoNext ? 'bg-accent' : 'bg-zinc-600'
                    }`}
                    onClick={() => {
                      const newVal = !autoNext;
                      setAutoNext(newVal);
                      localStorage.setItem('enable_autonext', String(newVal));
                    }}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                        autoNext ? 'translate-x-4' : ''
                      }`}
                    />
                  </div>
                </label>
                <button
                  onClick={() => setShowShortcuts(!showShortcuts)}
                  className='text-xs font-medium text-zinc-300 hover:text-white transition-colors'
                >
                  快捷鍵 ?
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

export default function PlayPage() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoading />}>
        <PlayPageClient />
      </Suspense>
    </ErrorBoundary>
  );
}
