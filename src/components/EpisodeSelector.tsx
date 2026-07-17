/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  precomputedVideoInfo?: Map<string, VideoInfo>;
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
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map()
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set()
  );
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());

  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  const [activeTab, setActiveTab] = useState<'episodes' | 'sources'>(
    totalEpisodes > 1 ? 'episodes' : 'sources'
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

  const recommendedSourceKey = useMemo(() => {
    const source = sortedAvailableSources.find(
      (candidate) =>
        !(
          candidate.source?.toString() === currentSource?.toString() &&
          candidate.id?.toString() === currentId?.toString()
        ) && !videoInfoMap.get(`${candidate.source}-${candidate.id}`)?.hasError
    );
    return source ? `${source.source}-${source.id}` : null;
  }, [currentId, currentSource, sortedAvailableSources, videoInfoMap]);

  useEffect(() => {
    if (!hasUserSelectedTabRef.current && totalEpisodes > 1) {
      setActiveTab('episodes');
    }
  }, [totalEpisodes]);

  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [descending, setDescending] = useState<boolean>(false);

  const displayPage = useMemo(() => {
    if (descending) {
      return pageCount - 1 - currentPage;
    }
    return currentPage;
  }, [currentPage, descending, pageCount]);

  const getVideoInfo = useCallback(async (source: SearchResult) => {
    const sourceKey = `${source.source}-${source.id}`;

    if (attemptedSourcesRef.current.has(sourceKey)) {
      return;
    }

    if (!source.episodes || source.episodes.length === 0) {
      return;
    }
    const episodeUrl =
      source.episodes.length > 1 ? source.episodes[1] : source.episodes[0];

    setAttemptedSources((prev) => new Set(prev).add(sourceKey));

    try {
      const info = await getVideoResolutionFromM3u8(episodeUrl);
      setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
    } catch {
      setVideoInfoMap((prev) =>
        new Map(prev).set(sourceKey, {
          quality: '錯誤',
          loadSpeed: '未知',
          pingTime: 0,
          hasError: true,
        })
      );
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
      if (
        !optimizationEnabled ||
        activeTab !== 'sources' ||
        availableSources.length === 0
      )
        return;

      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        return !attemptedSourcesRef.current.has(sourceKey);
      });

      if (pendingSources.length === 0) return;

      const batchSize = Math.ceil(pendingSources.length / 2);

      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map(getVideoInfo));
      }
    };

    fetchVideoInfosInBatches();
  }, [activeTab, availableSources, getVideoInfo, optimizationEnabled]);

  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

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
    totalEpisodes
  );

  return (
    <div className='h-full flex flex-col glass-panel rounded-2xl overflow-hidden shadow-2xl'>
      {/* Tab 切換 */}
      <div className='flex flex-shrink-0 bg-black/40'>
        {totalEpisodes > 1 && (
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
              onClick={() => setDescending((prev) => !prev)}
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

          {/* 集數網格 */}
          <div className='flex-1 overflow-y-auto scrollbar-hide'>
            <div className='grid grid-cols-5 sm:grid-cols-8 gap-2.5'>
              {(() => {
                const len = currentEnd - currentStart + 1;
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
              {sortedAvailableSources.map((source) => {
                const isCurrentSource =
                  source.source?.toString() === currentSource?.toString() &&
                  source.id?.toString() === currentId?.toString();
                const sourceKey = `${source.source}-${source.id}`;
                const videoInfo = videoInfoMap.get(sourceKey);
                return (
                  <div
                    key={sourceKey}
                    onClick={() =>
                      !isCurrentSource && handleSourceClick(source)
                    }
                    className={`group relative flex items-center gap-4 p-3 rounded-xl transition-all duration-300 cursor-pointer ${
                      isCurrentSource
                        ? 'bg-zinc-800 border border-zinc-700/55'
                        : 'bg-zinc-800/70 hover:bg-zinc-800 border border-zinc-700/40 hover:border-zinc-600/80'
                    }`}
                  >
                    {/* 封面 */}
                    <div className='w-14 h-20 sm:w-16 sm:h-24 bg-zinc-800 rounded-lg overflow-hidden flex-shrink-0 ring-1 ring-white/5'>
                      {source.episodes &&
                      source.episodes.length > 0 &&
                      !failedImages.has(sourceKey) ? (
                        <img
                          src={processImageUrl(source.poster)}
                          alt={source.title}
                          className='w-full h-full object-cover'
                          referrerPolicy='no-referrer'
                          onError={(e) => {
                            const img = e.currentTarget;
                            if (!img.dataset.retried && source.poster) {
                              // 直連失敗，改走伺服器代理
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
                      ) : source.episodes && source.episodes.length > 0 ? (
                        <div className='w-full h-full flex items-center justify-center bg-zinc-800'>
                          <span className='text-zinc-200 text-[11px] font-medium text-center px-1 leading-tight'>
                            {source.title}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {/* 資訊區域 */}
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-start justify-between gap-2 mb-1.5'>
                        <h3 className='font-bold text-white text-[15px] sm:text-base truncate leading-tight group-hover:text-white transition-colors'>
                          {source.title}
                        </h3>
                        {!isCurrentSource &&
                          sourceKey === recommendedSourceKey && (
                            <span className='shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent ring-1 ring-accent/40'>
                              推薦
                            </span>
                          )}
                      </div>

                      <div className='flex items-center gap-2 mb-2'>
                        <span className='text-[12px] px-2.5 py-1 bg-zinc-900/80 text-zinc-200 rounded-md font-medium border border-zinc-600/70 shadow-sm'>
                          {source.source_name || source.source}
                        </span>
                        {source.episodes.length > 1 && (
                          <span className='text-[12px] text-zinc-300 font-medium'>
                            {source.episodes.length} 集
                          </span>
                        )}
                      </div>

                      <div className='flex items-center gap-2 flex-wrap'>
                        {videoInfo && !videoInfo.hasError && (
                          <>
                            {videoInfo.quality !== '未知' && (
                              <span
                                className={`px-2.5 py-1 rounded text-[12px] font-bold ${
                                  ['4K', '2K'].includes(videoInfo.quality)
                                    ? 'bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/40'
                                    : ['1080p', '720p'].includes(
                                          videoInfo.quality
                                        )
                                      ? 'bg-green-500/20 text-green-200 ring-1 ring-green-400/40'
                                      : 'bg-yellow-500/20 text-yellow-200 ring-1 ring-yellow-400/40'
                                }`}
                              >
                                {videoInfo.quality}
                              </span>
                            )}
                            <span className='text-[12px] text-emerald-300 font-medium'>
                              {videoInfo.loadSpeed}
                            </span>
                            <span className='text-[12px] text-orange-300 font-medium'>
                              {videoInfo.pingTime}ms
                            </span>
                          </>
                        )}
                        {videoInfo?.hasError && (
                          <span className='px-2.5 py-1 rounded text-[12px] font-semibold bg-red-500/20 text-red-200 ring-1 ring-red-400/40'>
                            無法連接
                          </span>
                        )}
                        {videoInfo &&
                          !videoInfo.hasError &&
                          videoInfo.pingTime <= 1500 && (
                            <span className='rounded bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300'>
                              較穩定
                            </span>
                          )}
                        {videoInfo &&
                          !videoInfo.hasError &&
                          videoInfo.pingTime > 1500 && (
                            <span className='rounded bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-300'>
                              回應較慢
                            </span>
                          )}
                      </div>
                    </div>

                    {/* 當前標記 */}
                    {isCurrentSource && (
                      <div className='absolute top-2 right-2'>
                        <span className='px-2.5 py-0.5 bg-accent text-white text-[10px] font-bold rounded-full shadow-lg'>
                          當前
                        </span>
                      </div>
                    )}

                    {/* 非當前源顯示箭頭提示 */}
                    {!isCurrentSource && (
                      <div className='absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
                        <svg
                          className='w-5 h-5 text-zinc-200'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth='2'
                            d='M9 5l7 7-7 7'
                          />
                        </svg>
                      </div>
                    )}
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
