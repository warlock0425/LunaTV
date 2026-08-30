/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { toDisplayLanguage } from '@/lib/chinese';
import {
  filterSourcesPreferHighQuality,
  getDisplayedSourceEpisodeCount,
  getEpisodeSelectorCounts,
  hydrateSearchResultEpisodes,
  hydrateSearchResultEpisodesWithRetry,
  needsEpisodeHydration,
  pickFirstPlayableEpisodeUrl,
  pickRecommendedSourceKey,
  pickSourceVersionTag,
  pickSpeedTestEpisodeUrl,
  readEpisodeDescendingPreference,
  writeEpisodeDescendingPreference,
} from '@/lib/play-page-utils';
import { SearchResult } from '@/lib/types';
import {
  getProxiedImageUrl,
  getVideoResolutionFromM3u8,
  processImageUrl,
} from '@/lib/utils';

interface VideoInfo {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
}

export interface EpisodeSelectorProps {
  totalEpisodes: number;
  episodes_titles: string[];
  episodesPerPage?: number;
  value?: number;
  onChange?: (episodeNumber: number) => void;
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  precomputedVideoInfo?: Map<string, VideoInfo>;
  /** 為 true 時切到換源 tab（例如播放失敗後引導換源） */
  preferSourcesTab?: boolean;
  /** 背景補到播放網址時回寫，換源點擊就不必再等詳情 */
  onSourceHydrated?: (source: SearchResult) => void;
}

const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
  preferSourcesTab = false,
  onSourceHydrated,
}) => {
  const router = useRouter();
  const currentSourceInfo = useMemo(() => {
    return availableSources.find(
      (source) =>
        source.source?.toString() === currentSource?.toString() &&
        source.id?.toString() === currentId?.toString()
    );
  }, [availableSources, currentSource, currentId]);

  const episodeCounts = useMemo(
    () => getEpisodeSelectorCounts(currentSourceInfo, totalEpisodes),
    [currentSourceInfo, totalEpisodes]
  );
  // 格子只畫已載入網址；備註集數只決定要不要出現「選集」Tab
  const selectableEpisodeCount = episodeCounts.loaded;
  const showEpisodeTab = episodeCounts.showEpisodeTab;
  const pageCount = Math.max(
    1,
    Math.ceil(Math.max(selectableEpisodeCount, 1) / episodesPerPage)
  );

  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map()
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  /** 使用者手動展開較低畫質片源（有 1080p+ 時預設隱藏） */
  const [showLowerQuality, setShowLowerQuality] = useState(false);

  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const speedTestInFlightRef = useRef<Set<string>>(new Set());
  const triedSpeedTestUrlRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());
  const onSourceHydratedRef = useRef(onSourceHydrated);
  const speedTestEpisodeIndexRef = useRef(Math.max(0, value - 1));

  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    onSourceHydratedRef.current = onSourceHydrated;
  }, [onSourceHydrated]);

  useEffect(() => {
    speedTestEpisodeIndexRef.current = Math.max(0, value - 1);
  }, [value]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  const currentHydrateKeyRef = useRef('');
  const [activeTab, setActiveTab] = useState<'episodes' | 'sources'>(
    showEpisodeTab ? 'episodes' : 'sources'
  );
  const hasUserSelectedTabRef = useRef(false);

  const sortedAvailableSources = useMemo(() => {
    const originalOrder = new Map(
      availableSources.map((source, index) => [
        `${source.source}-${source.id}`,
        index,
      ])
    );
    return [...availableSources].sort((a, b) => {
      const aIsCurrent =
        a.source?.toString() === currentSource?.toString() &&
        a.id?.toString() === currentId?.toString();
      const bIsCurrent =
        b.source?.toString() === currentSource?.toString() &&
        b.id?.toString() === currentId?.toString();
      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;
      const aKey = `${a.source}-${a.id}`;
      const bKey = `${b.source}-${b.id}`;
      const aInfo = videoInfoMap.get(aKey);
      const bInfo = videoInfoMap.get(bKey);
      if (Boolean(aInfo?.hasError) !== Boolean(bInfo?.hasError)) {
        return aInfo?.hasError ? 1 : -1;
      }
      if (Boolean(aInfo) !== Boolean(bInfo)) return aInfo ? -1 : 1;
      if (aInfo && bInfo && aInfo.pingTime !== bInfo.pingTime) {
        return aInfo.pingTime - bInfo.pingTime;
      }
      return (originalOrder.get(aKey) || 0) - (originalOrder.get(bKey) || 0);
    });
  }, [availableSources, currentSource, currentId, videoInfoMap]);

  // 有 1080p+ 時隱藏 720p／480p；完全沒有高畫質、或使用者展開時才全部顯示
  const preferredOnlySources = useMemo(
    () =>
      filterSourcesPreferHighQuality(sortedAvailableSources, {
        currentSource,
        currentId,
        getInfo: (key) => videoInfoMap.get(key),
      }),
    [sortedAvailableSources, currentSource, currentId, videoInfoMap]
  );

  const hiddenLowerQualityCount = Math.max(
    0,
    sortedAvailableSources.length - preferredOnlySources.length
  );

  const displayAvailableSources = showLowerQuality
    ? sortedAvailableSources
    : preferredOnlySources;

  const recommendedSourceKey = useMemo(
    () =>
      pickRecommendedSourceKey(displayAvailableSources, {
        currentSource,
        currentId,
        getInfo: (key) => videoInfoMap.get(key),
      }),
    [currentId, currentSource, displayAvailableSources, videoInfoMap]
  );

  useEffect(() => {
    if (!hasUserSelectedTabRef.current && showEpisodeTab) {
      setActiveTab('episodes');
    }
  }, [showEpisodeTab]);

  // 備註寫 1184 集、清單只有探針時，重試補詳情再畫格子
  useEffect(() => {
    if (!currentSourceInfo || !needsEpisodeHydration(currentSourceInfo)) {
      return;
    }
    const key = `${currentSourceInfo.source}-${currentSourceInfo.id}`;
    if (currentHydrateKeyRef.current === key) return;
    currentHydrateKeyRef.current = key;
    const snapshot = currentSourceInfo;
    void hydrateSearchResultEpisodesWithRetry(snapshot, undefined, {
      force: true,
      attempts: 3,
    })
      .then((hydrated) => {
        if (currentHydrateKeyRef.current !== key) return;
        if (hydrated.episodes?.length) {
          onSourceHydratedRef.current?.(hydrated);
        }
      })
      .catch(() => undefined);
  }, [currentSource, currentId, currentSourceInfo]);

  // 播放失敗引導換源：render 期同步 tab，避免 effect 內 setState  cascading
  const [prevPreferSourcesTab, setPrevPreferSourcesTab] =
    useState(preferSourcesTab);
  if (preferSourcesTab !== prevPreferSourcesTab) {
    setPrevPreferSourcesTab(preferSourcesTab);
    if (preferSourcesTab) {
      setActiveTab('sources');
    }
  }

  const selectedValuePage = Math.min(
    Math.max(0, pageCount - 1),
    Math.max(0, Math.floor((value - 1) / episodesPerPage))
  );
  const selectedValuePageKey = `${value}:${episodesPerPage}:${pageCount}`;
  const [currentPage, setCurrentPage] = useState<number>(selectedValuePage);
  const [lastSelectedValuePageKey, setLastSelectedValuePageKey] =
    useState(selectedValuePageKey);
  const [descending, setDescending] = useState<boolean>(() =>
    readEpisodeDescendingPreference()
  );

  if (lastSelectedValuePageKey !== selectedValuePageKey) {
    setLastSelectedValuePageKey(selectedValuePageKey);
    setCurrentPage(selectedValuePage);
  }

  const displayPage = useMemo(() => {
    if (descending) {
      return pageCount - 1 - currentPage;
    }
    return currentPage;
  }, [currentPage, descending, pageCount]);

  const getVideoInfo = useCallback(async (source: SearchResult) => {
    const sourceKey = `${source.source}-${source.id}`;

    if (
      triedSpeedTestUrlRef.current.has(sourceKey) ||
      speedTestInFlightRef.current.has(sourceKey)
    ) {
      return;
    }
    speedTestInFlightRef.current.add(sourceKey);

    try {
      let working = source;
      const playingIndex = speedTestEpisodeIndexRef.current;
      let episodeUrl = pickSpeedTestEpisodeUrl(working.episodes, playingIndex);
      if (
        !episodeUrl &&
        !pickFirstPlayableEpisodeUrl(working.episodes) &&
        working.source &&
        working.id
      ) {
        try {
          working = await hydrateSearchResultEpisodes(working);
          if (pickFirstPlayableEpisodeUrl(working.episodes)) {
            onSourceHydratedRef.current?.(working);
          }
          episodeUrl = pickSpeedTestEpisodeUrl(working.episodes, playingIndex);
        } catch {
          episodeUrl = null;
        }
      }

      if (episodeUrl) {
        triedSpeedTestUrlRef.current.add(sourceKey);
        try {
          const info = await getVideoResolutionFromM3u8(episodeUrl);
          setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
        } catch {
          // 瀏覽器測速失敗（跨域／逾時）不代表片源不能播，不要標「無法連線」
        }
      }
    } finally {
      attemptedSourcesRef.current.add(sourceKey);
      setAttemptedSources((prev) => new Set(prev).add(sourceKey));
      speedTestInFlightRef.current.delete(sourceKey);
    }
  }, []);

  // precomputedVideoInfo 變化時合併測速結果（render 期調整狀態）
  const [prevPrecomputed, setPrevPrecomputed] = useState(precomputedVideoInfo);
  if (precomputedVideoInfo !== prevPrecomputed) {
    setPrevPrecomputed(precomputedVideoInfo);
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => {
          newMap.set(key, value);
        });
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((info, key) => {
          if (!info.hasError) {
            newSet.add(key);
          }
        });
        return newSet;
      });
    }
  }

  // ref 同步不可在 render 期進行，保留於 effect
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      precomputedVideoInfo.forEach((info, key) => {
        if (!info.hasError) {
          attemptedSourcesRef.current.add(key);
          triedSpeedTestUrlRef.current.add(key);
        }
      });
    }
  }, [precomputedVideoInfo]);

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

  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (!optimizationEnabled || availableSources.length === 0) return;

      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        if (speedTestInFlightRef.current.has(sourceKey)) return false;
        if (triedSpeedTestUrlRef.current.has(sourceKey)) return false;
        if (!attemptedSourcesRef.current.has(sourceKey)) return true;
        return Boolean(
          pickSpeedTestEpisodeUrl(
            source.episodes,
            speedTestEpisodeIndexRef.current
          )
        );
      });

      if (pendingSources.length === 0) return;

      const batchSize = 4;

      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map(getVideoInfo));
      }
    };

    fetchVideoInfosInBatches();
  }, [availableSources, getVideoInfo, optimizationEnabled]);

  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, selectableEpisodeCount);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, selectableEpisodeCount]);

  const categories = useMemo(() => {
    if (descending) {
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [isCategoryHovered, setIsCategoryHovered] = useState(false);

  const preventPageScroll = useCallback(
    (e: WheelEvent) => {
      if (isCategoryHovered) {
        e.preventDefault();
      }
    },
    [isCategoryHovered]
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (isCategoryHovered && categoryContainerRef.current) {
        e.preventDefault();
        const container = categoryContainerRef.current;
        const scrollAmount = e.deltaY * 2;
        container.scrollBy({
          left: scrollAmount,
          behavior: 'smooth',
        });
      }
    },
    [isCategoryHovered]
  );

  useEffect(() => {
    if (isCategoryHovered) {
      document.addEventListener('wheel', preventPageScroll, { passive: false });
      document.addEventListener('wheel', handleWheel, { passive: false });
    } else {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    }

    return () => {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    };
  }, [isCategoryHovered, preventPageScroll, handleWheel]);

  useEffect(() => {
    const btn = buttonRefs.current[displayPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;
      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth',
      });
    }
  }, [displayPage, pageCount]);

  const handleSourceTabClick = () => {
    hasUserSelectedTabRef.current = true;
    setActiveTab('sources');
  };

  const handleEpisodeTabClick = () => {
    hasUserSelectedTabRef.current = true;
    setActiveTab('episodes');
  };

  const handleCategoryClick = useCallback(
    (index: number) => {
      if (descending) {
        setCurrentPage(pageCount - 1 - index);
      } else {
        setCurrentPage(index);
      }
    },
    [descending, pageCount]
  );

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      onChange?.(episodeNumber);
    },
    [onChange]
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange]
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    selectableEpisodeCount
  );

  return (
    <div className='h-full flex flex-col glass-panel rounded-2xl overflow-hidden shadow-2xl'>
      {/* Tab 切換 */}
      <div className='flex flex-shrink-0 bg-black/40'>
        {showEpisodeTab && (
          <button
            onClick={handleEpisodeTabClick}
            className={`relative flex-1 py-4 px-6 text-sm font-bold tracking-wider transition-all duration-300 ${
              activeTab === 'episodes'
                ? 'text-white'
                : 'text-zinc-200 hover:text-white'
            }`}
          >
            <span className='relative z-10'>選集</span>
            {activeTab === 'episodes' && (
              <span className='absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-accent rounded-full' />
            )}
          </button>
        )}
        <button
          onClick={handleSourceTabClick}
          className={`relative flex-1 py-4 px-6 text-sm font-bold tracking-wider transition-all duration-300 ${
            activeTab === 'sources'
              ? 'text-white'
              : 'text-zinc-200 hover:text-white'
          }`}
        >
          <span className='relative z-10'>換源</span>
          {activeTab === 'sources' && (
            <span className='absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-0.5 bg-accent rounded-full' />
          )}
        </button>
      </div>

      {episodeCounts.advertised > selectableEpisodeCount &&
        selectableEpisodeCount <= 1 && (
          <p className='px-4 pt-2 text-xs text-zinc-400'>
            正在取得完整集數（來源標示 {episodeCounts.advertised} 集）
          </p>
        )}

      {/* 選集 Tab 內容 */}
      {activeTab === 'episodes' && (
        <div className='flex-1 overflow-hidden flex flex-col p-4 sm:p-6'>
          {/* 分類標籤 */}
          <div className='flex items-center gap-3 mb-5 flex-shrink-0'>
            <div
              className='flex-1 overflow-x-auto scrollbar-hide'
              ref={categoryContainerRef}
              onMouseEnter={() => setIsCategoryHovered(true)}
              onMouseLeave={() => setIsCategoryHovered(false)}
            >
              <div className='flex gap-2 min-w-max'>
                {categories.map((label, idx) => {
                  const isActive = idx === displayPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`relative px-5 py-2 text-sm font-semibold rounded-full transition-all duration-200 whitespace-nowrap ${
                        isActive
                          ? 'bg-accent text-white font-bold shadow-md'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-200'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              className='flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white transition-all duration-200'
              onClick={() => {
                setDescending((prev) => {
                  const next = !prev;
                  writeEpisodeDescendingPreference(next);
                  return next;
                });
              }}
              title={descending ? '切換為正序' : '切換為倒序'}
            >
              <svg
                className={`w-4 h-4 transition-transform duration-300 ${
                  descending ? 'rotate-180' : ''
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12'
                />
              </svg>
            </button>
          </div>

          {/* 集數網格：只畫已載入網址，不依備註虛增按鈕 */}
          <div className='flex-1 overflow-y-auto scrollbar-hide'>
            {selectableEpisodeCount < 1 ? (
              <div className='h-full flex items-center justify-center text-sm text-zinc-400'>
                正在取得可選集數…
              </div>
            ) : (
              <div className='grid grid-cols-5 sm:grid-cols-8 gap-2.5'>
                {(() => {
                  const len = Math.max(0, currentEnd - currentStart + 1);
                  const episodes = Array.from({ length: len }, (_, i) =>
                    descending ? currentEnd - i : currentStart + i
                  );
                  return episodes;
                })().map((episodeNumber) => {
                  const isActive = episodeNumber === value;
                  return (
                    <button
                      key={episodeNumber}
                      onClick={() => handleEpisodeClick(episodeNumber - 1)}
                      className={`relative aspect-square flex flex-col items-center justify-center text-sm font-bold rounded-xl transition-all duration-200 ${
                        isActive
                          ? 'bg-accent text-white font-bold scale-105 shadow-md'
                          : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-white hover:scale-105'
                      }`}
                    >
                      <span className='text-base'>
                        {(() => {
                          const title = episodes_titles?.[episodeNumber - 1];
                          if (!title) return episodeNumber;
                          const match = title.match(/(?:第)?(\d+)(?:集|話)/);
                          if (match) return match[1];
                          return episodeNumber;
                        })()}
                      </span>
                      {isActive && (
                        <span className='absolute top-1 right-1 w-2 h-2 bg-accent rounded-full animate-pulse' />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 換源 Tab 內容 */}
      {activeTab === 'sources' && (
        <div className='flex-1 overflow-hidden flex flex-col'>
          {sourceSearchLoading && availableSources.length === 0 && (
            <div className='flex-1 flex items-center justify-center'>
              <div className='flex flex-col items-center gap-3'>
                <div className='w-8 h-8 border-[3px] border-white border-t-transparent rounded-full animate-spin' />
                <span className='text-zinc-200 text-sm font-medium tracking-wide'>
                  正在搜尋可用片源...
                </span>
              </div>
            </div>
          )}

          {sourceSearchError && availableSources.length === 0 && (
            <div className='flex-1 flex items-center justify-center'>
              <div className='text-center max-w-xs'>
                <div className='w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center'>
                  <span className='text-red-500 text-2xl'>!</span>
                </div>
                <p className='text-red-400 text-sm leading-relaxed'>
                  {sourceSearchError}
                </p>
              </div>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex-1 flex items-center justify-center'>
                <div className='text-center'>
                  <div className='w-20 h-20 mx-auto mb-4 rounded-2xl bg-zinc-800/50 flex items-center justify-center'>
                    <svg
                      className='w-8 h-8 text-zinc-200'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth='1.5'
                        d='M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z'
                      />
                    </svg>
                  </div>
                  <p className='text-zinc-200 text-sm font-medium'>
                    暫無其他可用片源
                  </p>
                </div>
              </div>
            )}

          {availableSources.length > 0 && (
            <div className='flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5'>
              {sourceSearchLoading && (
                <div className='flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/70 px-3 py-2 text-xs font-medium text-zinc-200'>
                  <div className='w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin' />
                  正在補充搜尋其他可用片源...
                </div>
              )}
              {hiddenLowerQualityCount > 0 && (
                <div className='flex items-center justify-between gap-2 px-0.5 pb-1'>
                  <p className='text-[11px] text-zinc-500'>
                    {showLowerQuality
                      ? '正在顯示全部畫質片源'
                      : `已優先顯示 1080p 以上（另 ${hiddenLowerQualityCount} 個較低畫質）`}
                  </p>
                  <button
                    type='button'
                    onClick={() => setShowLowerQuality((v) => !v)}
                    className='shrink-0 text-[11px] font-medium text-accent hover:text-accent/80 transition-colors'
                  >
                    {showLowerQuality
                      ? '只看高畫質'
                      : `顯示較低畫質 (${hiddenLowerQualityCount})`}
                  </button>
                </div>
              )}
              {displayAvailableSources.map((source) => {
                const sourceKey = `${source.source}-${source.id}`;
                const displaySource = source;
                const displayedEpisodes =
                  getDisplayedSourceEpisodeCount(displaySource);
                const extraTag = pickSourceVersionTag(source.title, videoTitle);
                const isCurrentSource =
                  displaySource.source?.toString() ===
                    currentSource?.toString() &&
                  displaySource.id?.toString() === currentId?.toString();
                const videoInfo = videoInfoMap.get(sourceKey);
                return (
                  <div
                    key={sourceKey}
                    onClick={() =>
                      !isCurrentSource && handleSourceClick(displaySource)
                    }
                    className={`group relative flex items-center gap-3 p-3 rounded-xl transition-all duration-300 cursor-pointer ${
                      isCurrentSource
                        ? 'bg-accent/10 border border-accent/40 border-l-[3px] border-l-accent ring-1 ring-accent/20'
                        : videoInfo?.hasError
                          ? 'bg-zinc-800/40 border border-zinc-700/30 opacity-75'
                          : 'bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/40 hover:border-zinc-600/80'
                    }`}
                  >
                    {/* 封面（縮小：換源時重點是片源名與測速，不是再讀一遍片名） */}
                    <div className='w-12 h-[4.5rem] sm:w-14 sm:h-20 bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-white/5'>
                      {displaySource.poster && !failedImages.has(sourceKey) ? (
                        <img
                          src={processImageUrl(displaySource.poster)}
                          alt=''
                          className='w-full h-full object-cover'
                          referrerPolicy='no-referrer'
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (!img.dataset.retried && displaySource.poster) {
                              img.dataset.retried = 'true';
                              img.src = getProxiedImageUrl(source.poster);
                              return;
                            }
                            setFailedImages((prev) => {
                              const next = new Set(prev);
                              next.add(sourceKey);
                              return next;
                            });
                          }}
                        />
                      ) : (
                        <div className='w-full h-full flex items-center justify-center bg-zinc-800 text-[10px] text-zinc-500'>
                          —
                        </div>
                      )}
                    </div>

                    {/* 資訊：主標 = 片源名；次標 = 集數與版本標籤；底欄 = 統一指標 */}
                    <div className='flex-1 min-w-0 pr-1'>
                      <div className='flex items-center justify-between gap-2 mb-1'>
                        <h3
                          className={`font-bold truncate leading-tight text-[15px] sm:text-base ${
                            isCurrentSource ? 'text-accent' : 'text-white'
                          }`}
                          title={source.source_name || source.source}
                        >
                          {source.source_name || source.source}
                        </h3>
                        <div className='flex items-center gap-1.5 shrink-0'>
                          {isCurrentSource && (
                            <span className='px-2 py-0.5 bg-accent text-white text-[10px] font-bold rounded-full shadow-lg'>
                              播放中
                            </span>
                          )}
                          {!isCurrentSource &&
                            sourceKey === recommendedSourceKey && (
                              <span className='rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent ring-1 ring-accent/40'>
                                推薦
                              </span>
                            )}
                        </div>
                      </div>

                      {/* 次標：統一顯示「N 集」，過濾重複主片名，僅保留版本標籤（如國語、4K） */}
                      <div className='flex items-center gap-2 mb-2 min-w-0'>
                        <span className='text-[12px] font-semibold text-zinc-300 shrink-0 tabular-nums px-1.5 py-0.5 rounded bg-zinc-800/80 border border-white/5'>
                          {displayedEpisodes > 0
                            ? `${displayedEpisodes} 集`
                            : '單集'}
                        </span>
                        {extraTag ? (
                          <span className='text-[11px] px-1.5 py-0.5 rounded bg-accent/10 text-accent shrink-0 truncate max-w-[120px] font-medium'>
                            {toDisplayLanguage(extraTag)}
                          </span>
                        ) : null}
                      </div>

                      {/* 底欄：統一三格指標（畫質標籤、速度、延遲、穩定度） */}
                      <div className='flex items-center gap-2 flex-wrap text-[11px]'>
                        {videoInfo && !videoInfo.hasError && (
                          <>
                            <span
                              className={`px-2 py-0.5 rounded font-bold ${
                                ['4K', '2K'].includes(videoInfo.quality)
                                  ? 'bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/40'
                                  : videoInfo.quality === '1080p'
                                    ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40'
                                    : videoInfo.quality === '720p'
                                      ? 'bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40'
                                      : videoInfo.quality === '未知'
                                        ? 'bg-zinc-800 text-zinc-400 border border-white/5'
                                        : 'bg-yellow-500/20 text-yellow-200 ring-1 ring-yellow-400/40'
                              }`}
                            >
                              {videoInfo.quality !== '未知'
                                ? videoInfo.quality
                                : '未測得'}
                            </span>
                            <span className='text-emerald-300 font-medium tabular-nums'>
                              {videoInfo.loadSpeed}
                            </span>
                            <span className='text-orange-300 font-medium tabular-nums'>
                              {videoInfo.pingTime}ms
                            </span>
                          </>
                        )}
                        {videoInfo?.hasError && (
                          <span className='px-2 py-0.5 rounded font-semibold bg-red-500/20 text-red-200 ring-1 ring-red-400/40'>
                            無法連線
                          </span>
                        )}
                        {!videoInfo && !attemptedSources.has(sourceKey) && (
                          <span className='text-zinc-500'>測速中…</span>
                        )}
                        {videoInfo &&
                          !videoInfo.hasError &&
                          videoInfo.pingTime <= 1500 && (
                            <span className='rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300'>
                              較穩定
                            </span>
                          )}
                        {videoInfo &&
                          !videoInfo.hasError &&
                          videoInfo.pingTime > 1500 && (
                            <span className='rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300'>
                              回應較慢
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                );
              })}

              <button
                onClick={() => {
                  if (videoTitle) {
                    router.push(`/search?q=${encodeURIComponent(videoTitle)}`);
                  }
                }}
                className='w-full text-center text-[13px] text-zinc-300 hover:text-white transition-colors py-3 mt-1 font-medium tracking-wide'
              >
                沒有找到合適的片源？手動搜尋
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;
