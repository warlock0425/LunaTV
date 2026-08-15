/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */

import {
  ExternalLink,
  Heart,
  Link,
  PlayCircleIcon,
  Trash2,
} from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import React, {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { buildPlayUrl } from '@/lib/play-url';
import { getProxiedImageUrl, processImageUrl } from '@/lib/utils';
import { useLongPress } from '@/hooks/useLongPress';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import MobileActionSheet from '@/components/MobileActionSheet';
import { useToast } from '@/components/ToastProvider';
import {
  AggregateSourcesIndicator,
  CardDoubanBadge,
  CardGlassPanel,
} from '@/components/video-card-parts';

export interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  source_names?: string[];
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: number;
  onDelete?: () => void;
  rate?: string;
  type?: string;
  type_name?: string;
  isBangumi?: boolean;
  isAggregate?: boolean;
  origin?: 'vod' | 'live';
}

export type VideoCardHandle = {
  setEpisodes: (episodes?: number) => void;
  setSourceNames: (names?: string[]) => void;
  setDoubanId: (id?: number) => void;
};

const VideoCard = forwardRef<VideoCardHandle, VideoCardProps>(
  function VideoCard(
    {
      id,
      title = '',
      query = '',
      poster = '',
      episodes,
      source,
      source_name,
      source_names,
      progress = 0,
      year,
      from,
      currentEpisode,
      douban_id,
      onDelete,
      rate,
      type = '',
      type_name,
      isBangumi = false,
      isAggregate = false,
      origin = 'vod',
    }: VideoCardProps,
    ref
  ) {
    const router = useRouter();
    const [favorited, setFavorited] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [imgError, setImgError] = useState(false);
    const [showMobileActions, setShowMobileActions] = useState(false);
    const { toast } = useToast();
    const [searchFavorited, setSearchFavorited] = useState<boolean | null>(
      null
    ); // 搜尋結果的收藏狀態

    // 可外部修改的可控字段
    const [dynamicEpisodes, setDynamicEpisodes] = useState<number | undefined>(
      episodes
    );
    const [dynamicSourceNames, setDynamicSourceNames] = useState<
      string[] | undefined
    >(source_names);
    const [dynamicDoubanId, setDynamicDoubanId] = useState<number | undefined>(
      douban_id
    );

    useEffect(() => {
      setDynamicEpisodes(episodes);
    }, [episodes]);

    useEffect(() => {
      setDynamicSourceNames(source_names);
    }, [source_names]);

    useEffect(() => {
      setDynamicDoubanId(douban_id);
    }, [douban_id]);

    useImperativeHandle(ref, () => ({
      setEpisodes: (eps?: number) => setDynamicEpisodes(eps),
      setSourceNames: (names?: string[]) => setDynamicSourceNames(names),
      setDoubanId: (id?: number) => setDynamicDoubanId(id),
    }));

    const actualTitle = title;
    const actualPoster = poster;
    const actualSource =
      !source || source === 'undefined' || source === 'null' ? '' : source;
    const actualId = !id || id === 'undefined' || id === 'null' ? '' : id;
    const displaySourceName = source_name?.replace(/^🎬\s*/, '') || '';
    const actualDoubanId = dynamicDoubanId;
    const actualEpisodes = dynamicEpisodes;
    const actualYear = year;
    const actualQuery = query || title || '';
    const actualSearchType = isBangumi
      ? 'tv'
      : isAggregate
        ? actualEpisodes && actualEpisodes === 1
          ? 'movie'
          : 'tv'
        : type;
    // 取得收藏狀態（搜尋結果頁面不檢查）
    useEffect(() => {
      if (!actualSource || !actualId) return;

      const fetchFavoriteStatus = async () => {
        try {
          const fav = await isFavorited(actualSource, actualId);
          setFavorited(fav);
        } catch (err) {
          console.error('檢查收藏狀態失敗', err);
        }
      };

      fetchFavoriteStatus();

      // 監聽收藏狀態更新事件
      const storageKey = generateStorageKey(actualSource, actualId);
      const unsubscribe = subscribeToDataUpdates(
        'favoritesUpdated',
        (newFavorites: Record<string, any>) => {
          // 檢查當前項目是否在新的收藏列表中
          const isNowFavorited = !!newFavorites[storageKey];
          setFavorited(isNowFavorited);
        }
      );

      return unsubscribe;
    }, [from, actualSource, actualId]);

    const handleToggleFavorite = useCallback(
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (from === 'douban' || !actualSource || !actualId) return;

        try {
          // 確定當前收藏狀態
          const currentFavorited =
            from === 'search' ? searchFavorited : favorited;

          if (currentFavorited) {
            // 如果已收藏，刪除收藏
            await deleteFavorite(actualSource, actualId);
            if (from === 'search') {
              setSearchFavorited(false);
            } else {
              setFavorited(false);
            }
            toast('已取消收藏', 'info');
          } else {
            // 如果未收藏，新增收藏
            await saveFavorite(actualSource, actualId, {
              title: actualTitle,
              source_name: source_name || '',
              year: actualYear || '',
              cover: actualPoster,
              total_episodes: actualEpisodes ?? 1,
              save_time: Date.now(),
            });
            if (from === 'search') {
              setSearchFavorited(true);
            } else {
              setFavorited(true);
            }
            toast('✨ 已加入收藏', 'success');
          }
        } catch (err) {
          console.error('切換收藏狀態失敗', err);
          toast('切換收藏狀態失敗', 'error');
        }
      },
      [
        from,
        actualSource,
        actualId,
        actualTitle,
        source_name,
        actualYear,
        actualPoster,
        actualEpisodes,
        favorited,
        searchFavorited,
      ]
    );

    const handleDeleteRecord = useCallback(
      async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (from !== 'playrecord' || !actualSource || !actualId) return;
        try {
          await deletePlayRecord(actualSource, actualId, {
            title: actualTitle,
            source_name: source_name || '',
          });
          onDelete?.();
          toast('已刪除觀看紀錄', 'info');
        } catch (err) {
          console.error('刪除播放記錄失敗', err);
          toast('刪除紀錄失敗', 'error');
        }
      },
      [from, actualSource, actualId, onDelete]
    );

    const handleClick = useCallback(() => {
      if (origin === 'live' && actualSource && actualId) {
        // 直播內容跳轉到直播頁面
        const params = new URLSearchParams({
          source: actualSource.replace('live_', ''),
          id: actualId.replace('live_', ''),
        });
        const url = `/live?${params.toString()}`;
        router.push(url);
      } else if (
        from === 'douban' ||
        (isAggregate && !actualSource && !actualId)
      ) {
        const url = buildPlayUrl({
          title: actualTitle,
          year: actualYear,
          stype: actualSearchType,
          prefer: isAggregate,
          stitle: actualQuery,
          bgmId: isBangumi ? actualDoubanId : undefined,
        });
        router.push(url);
      } else if (actualSource && actualId) {
        const url = buildPlayUrl({
          source: actualSource,
          id: actualId,
          title: actualTitle,
          year: actualYear,
          prefer: isAggregate,
          stitle: actualQuery,
          stype: actualSearchType,
          bgmId: isBangumi ? actualDoubanId : undefined,
          episode:
            from === 'playrecord' && currentEpisode && currentEpisode > 0
              ? currentEpisode
              : undefined,
        });
        router.push(url);
      } else {
        const url = buildPlayUrl({
          title: actualTitle,
          year: actualYear,
          stype: actualSearchType,
          prefer: true,
          stitle: actualQuery,
          bgmId: isBangumi ? actualDoubanId : undefined,
        });
        router.push(url);
      }
    }, [
      origin,
      from,
      actualSource,
      actualId,
      router,
      actualTitle,
      actualYear,
      isAggregate,
      actualQuery,
      actualSearchType,
      isBangumi,
      actualDoubanId,
      currentEpisode,
    ]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        handleClick();
      },
      [handleClick]
    );

    // 新標籤頁播放處理函數
    const handlePlayInNewTab = useCallback(() => {
      if (origin === 'live' && actualSource && actualId) {
        // 直播內容跳轉到直播頁面
        const params = new URLSearchParams({
          source: actualSource.replace('live_', ''),
          id: actualId.replace('live_', ''),
        });
        const url = `/live?${params.toString()}`;
        window.open(url, '_blank');
      } else if (
        from === 'douban' ||
        (isAggregate && !actualSource && !actualId)
      ) {
        const url = buildPlayUrl({
          title: actualTitle,
          year: actualYear,
          stype: actualSearchType,
          prefer: isAggregate,
          stitle: actualQuery,
          bgmId: isBangumi ? actualDoubanId : undefined,
        });
        window.open(url, '_blank');
      } else if (actualSource && actualId) {
        const url = buildPlayUrl({
          source: actualSource,
          id: actualId,
          title: actualTitle,
          year: actualYear,
          prefer: isAggregate,
          stitle: actualQuery,
          stype: actualSearchType,
          bgmId: isBangumi ? actualDoubanId : undefined,
          episode:
            from === 'playrecord' && currentEpisode && currentEpisode > 0
              ? currentEpisode
              : undefined,
        });
        window.open(url, '_blank');
      } else {
        const url = buildPlayUrl({
          title: actualTitle,
          year: actualYear,
          stype: actualSearchType,
          prefer: true,
          stitle: actualQuery,
          bgmId: isBangumi ? actualDoubanId : undefined,
        });
        window.open(url, '_blank');
      }
    }, [
      origin,
      from,
      actualSource,
      actualId,
      actualTitle,
      actualYear,
      isAggregate,
      actualQuery,
      actualSearchType,
      isBangumi,
      actualDoubanId,
      currentEpisode,
    ]);

    // 檢查搜尋結果的收藏狀態
    const checkSearchFavoriteStatus = useCallback(async () => {
      if (
        from === 'search' &&
        !isAggregate &&
        actualSource &&
        actualId &&
        searchFavorited === null
      ) {
        try {
          const fav = await isFavorited(actualSource, actualId);
          setSearchFavorited(fav);
        } catch (err) {
          setSearchFavorited(false);
        }
      }
    }, [from, isAggregate, actualSource, actualId, searchFavorited]);

    // 長按操作
    const handleLongPress = useCallback(() => {
      if (!showMobileActions) {
        // 防止重複觸發
        // 立即顯示選單，避免等待資料載入導致動畫卡頓
        setShowMobileActions(true);

        // 異步檢查收藏狀態，不阻塞選單顯示
        if (
          from === 'search' &&
          !isAggregate &&
          actualSource &&
          actualId &&
          searchFavorited === null
        ) {
          checkSearchFavoriteStatus();
        }
      }
    }, [
      showMobileActions,
      from,
      isAggregate,
      actualSource,
      actualId,
      searchFavorited,
      checkSearchFavoriteStatus,
    ]);

    // 長按手勢hook
    const longPressProps = useLongPress({
      onLongPress: handleLongPress,
      onClick: handleClick, // 保持點擊播放功能
      longPressDelay: 500,
    });

    const config = useMemo(() => {
      const configs = {
        playrecord: {
          showSourceName: true,
          showProgress: true,
          showPlayButton: true,
          showHeart: true,
          showCheckCircle: true,
          showDoubanLink: false,
          showRating: false,
          showYear: false,
        },
        favorite: {
          showSourceName: true,
          showProgress: false,
          showPlayButton: true,
          showHeart: true,
          showCheckCircle: false,
          showDoubanLink: false,
          showRating: false,
          showYear: false,
        },
        search: {
          showSourceName: true,
          showProgress: false,
          showPlayButton: true,
          showHeart: true, // 移動端選單中需要顯示收藏選項
          showCheckCircle: false,
          showDoubanLink: true, // 移動端選單中顯示豆瓣鏈接
          showRating: false,
          showYear: true,
        },
        douban: {
          showSourceName: false,
          showProgress: false,
          showPlayButton: true,
          showHeart: false,
          showCheckCircle: false,
          showDoubanLink: true,
          showRating: !!rate,
          showYear: true,
        },
      };
      return configs[from] || configs.search;
    }, [from, isAggregate, douban_id, rate]);

    // 移動端操作選單設定
    const mobileActions = useMemo(() => {
      const actions = [];

      // 播放操作
      if (config.showPlayButton) {
        actions.push({
          id: 'play',
          label: origin === 'live' ? '觀看直播' : '播放',
          icon: <PlayCircleIcon size={20} />,
          onClick: handleClick,
          color: 'primary' as const,
        });

        // 新標籤頁播放
        actions.push({
          id: 'play-new-tab',
          label: origin === 'live' ? '新標籤頁觀看' : '新標籤頁播放',
          icon: <ExternalLink size={20} />,
          onClick: handlePlayInNewTab,
          color: 'default' as const,
        });
      }

      // 聚合源資訊 - 直接在選單中展示，不需要單獨的操作項

      // 收藏/取消收藏操作
      if (config.showHeart && from !== 'douban' && actualSource && actualId) {
        const currentFavorited =
          from === 'search' ? searchFavorited : favorited;

        if (from === 'search') {
          // 搜尋結果：根據載入狀態顯示不同的選項
          if (searchFavorited !== null) {
            // 已載入完成，顯示實際的收藏狀態
            actions.push({
              id: 'favorite',
              label: currentFavorited ? '取消收藏' : '新增收藏',
              icon: currentFavorited ? (
                <Heart size={20} className='fill-red-600 stroke-red-600' />
              ) : (
                <Heart size={20} className='fill-transparent stroke-red-500' />
              ),
              onClick: () => {
                const mockEvent = {
                  preventDefault: () => {},
                  stopPropagation: () => {},
                } as React.MouseEvent;
                handleToggleFavorite(mockEvent);
              },
              color: currentFavorited
                ? ('danger' as const)
                : ('default' as const),
            });
          } else {
            // 正在載入中，顯示占位項
            actions.push({
              id: 'favorite-loading',
              label: '收藏載入中...',
              icon: <Heart size={20} />,
              onClick: () => {}, // 載入中時不響應點擊
              disabled: true,
            });
          }
        } else {
          // 非搜尋結果：直接顯示收藏選項
          actions.push({
            id: 'favorite',
            label: currentFavorited ? '取消收藏' : '新增收藏',
            icon: currentFavorited ? (
              <Heart size={20} className='fill-red-600 stroke-red-600' />
            ) : (
              <Heart size={20} className='fill-transparent stroke-red-500' />
            ),
            onClick: () => {
              const mockEvent = {
                preventDefault: () => {},
                stopPropagation: () => {},
              } as React.MouseEvent;
              handleToggleFavorite(mockEvent);
            },
            color: currentFavorited
              ? ('danger' as const)
              : ('default' as const),
          });
        }
      }

      // 刪除播放記錄操作
      if (
        config.showCheckCircle &&
        from === 'playrecord' &&
        actualSource &&
        actualId
      ) {
        actions.push({
          id: 'delete',
          label: '刪除記錄',
          icon: <Trash2 size={20} />,
          onClick: () => {
            const mockEvent = {
              preventDefault: () => {},
              stopPropagation: () => {},
            } as React.MouseEvent;
            handleDeleteRecord(mockEvent);
          },
          color: 'danger' as const,
        });
      }

      // 豆瓣鏈接操作
      if (config.showDoubanLink && actualDoubanId && actualDoubanId !== 0) {
        actions.push({
          id: 'douban',
          label: isBangumi ? 'Bangumi 詳情' : '豆瓣詳情',
          icon: <Link size={20} />,
          onClick: () => {
            const url = isBangumi
              ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
              : `https://movie.douban.com/subject/${actualDoubanId.toString()}`;
            window.open(url, '_blank', 'noopener,noreferrer');
          },
          color: 'default' as const,
        });
      }

      return actions;
    }, [
      config,
      from,
      actualSource,
      actualId,
      favorited,
      searchFavorited,
      actualDoubanId,
      isBangumi,
      isAggregate,
      dynamicSourceNames,
      handleClick,
      handleToggleFavorite,
      handleDeleteRecord,
    ]);

    return (
      <>
        <div
          className='group relative w-full rounded-lg bg-transparent cursor-pointer transition-all duration-300 ease-out hover:scale-[1.05] hover:-translate-y-1 hover:shadow-xl hover:shadow-accent/20 hover:z-[500] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-deep'
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          role='article'
          aria-label={actualTitle}
          tabIndex={0}
          {...longPressProps}
          style={
            {
              // 禁用所有預設的長按和選擇效果
              WebkitUserSelect: 'none',
              userSelect: 'none',
              WebkitTouchCallout: 'none',
              WebkitTapHighlightColor: 'transparent',
              touchAction: 'manipulation',
              // 禁用右鍵選單和長按選單
              pointerEvents: 'auto',
            } as React.CSSProperties
          }
          onContextMenu={(e) => {
            // 阻止預設右鍵選單
            e.preventDefault();
            e.stopPropagation();

            // 右鍵彈出操作選單
            setShowMobileActions(true);

            // 異步檢查收藏狀態，不阻塞選單顯示
            if (
              from === 'search' &&
              !isAggregate &&
              actualSource &&
              actualId &&
              searchFavorited === null
            ) {
              checkSearchFavoriteStatus();
            }

            return false;
          }}
          onDragStart={(e) => {
            // 阻止拖拽
            e.preventDefault();
            return false;
          }}
        >
          {/* 海報容器 */}
          <div
            className={`relative aspect-[2/3] overflow-hidden rounded-lg ${
              origin === 'live'
                ? 'ring-1 ring-zinc-300/80 dark:ring-zinc-600/80'
                : ''
            }`}
            style={
              {
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              } as React.CSSProperties
            }
            onContextMenu={(e) => {
              e.preventDefault();
              return false;
            }}
          >
            {/* 骨架屏 */}
            {!isLoading && !imgError && (
              <ImagePlaceholder aspectRatio='aspect-[2/3]' />
            )}
            {/* 圖片 */}
            {!imgError ? (
              <Image
                src={processImageUrl(actualPoster)}
                alt={actualTitle}
                fill
                className={
                  origin === 'live' ? 'object-contain' : 'object-cover'
                }
                referrerPolicy='no-referrer'
                loading='lazy'
                onLoadingComplete={() => setIsLoading(true)}
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  if (!img.dataset.retried && actualPoster) {
                    // 直連失敗（防盜鏈／地區封鎖），改走伺服器代理
                    img.dataset.retried = 'true';
                    img.src = getProxiedImageUrl(actualPoster);
                  } else {
                    setImgError(true);
                  }
                }}
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                    pointerEvents: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
                onDragStart={(e) => {
                  e.preventDefault();
                  return false;
                }}
              />
            ) : (
              <div className='absolute inset-0 flex items-center justify-center bg-zinc-200 dark:bg-zinc-800'>
                <span className='text-zinc-700 dark:text-zinc-300 text-xs font-medium text-center px-2 line-clamp-3'>
                  {actualTitle}
                </span>
              </div>
            )}

            {/* 懸浮遮罩 */}
            <div
              className='absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent transition-opacity duration-300 ease-in-out opacity-0 group-hover:opacity-100'
              style={
                {
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitTouchCallout: 'none',
                } as React.CSSProperties
              }
              onContextMenu={(e) => {
                e.preventDefault();
                return false;
              }}
            />

            <div className='pointer-events-none absolute inset-0 rounded-lg border border-transparent transition-colors duration-200 group-hover:border-accent/70 group-focus-visible:border-accent' />

            {/* 播放按鈕 */}
            {config.showPlayButton && (
              <div
                data-button='true'
                className='absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 ease-in-out delay-75 group-hover:opacity-100 group-hover:scale-100'
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                <PlayCircleIcon
                  size={50}
                  strokeWidth={0.8}
                  className='text-white fill-transparent transition-all duration-300 ease-out hover:fill-accent hover:scale-[1.1]'
                  style={
                    {
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                />
              </div>
            )}

            {/* 操作按鈕 */}
            {(config.showHeart || config.showCheckCircle) && (
              <div
                data-button='true'
                className='absolute bottom-3 right-3 flex gap-3 opacity-0 translate-y-2 transition-all duration-300 ease-in-out sm:group-hover:opacity-100 sm:group-hover:translate-y-0'
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {config.showCheckCircle && (
                  <button
                    type='button'
                    data-button='true'
                    aria-label='刪除觀看紀錄'
                    onClick={handleDeleteRecord}
                    className='bg-transparent p-0 border-0 cursor-pointer'
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <Trash2
                      size={20}
                      aria-hidden
                      className='text-white transition-all duration-300 ease-out hover:stroke-red-500 hover:scale-[1.1]'
                      style={
                        {
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties
                      }
                    />
                  </button>
                )}
                {config.showHeart && from !== 'search' && (
                  <button
                    type='button'
                    data-button='true'
                    aria-label={favorited ? '取消收藏' : '加入收藏'}
                    onClick={handleToggleFavorite}
                    className='bg-transparent p-0 border-0 cursor-pointer'
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <Heart
                      size={20}
                      aria-hidden
                      className={`transition-all duration-300 ease-out ${
                        favorited
                          ? 'fill-red-600 stroke-red-600'
                          : 'fill-transparent stroke-white hover:stroke-red-400'
                      } hover:scale-[1.1]`}
                      style={
                        {
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties
                      }
                    />
                  </button>
                )}
              </div>
            )}

            {/* 年份徽章 */}
            {config.showYear &&
              actualYear &&
              actualYear !== 'unknown' &&
              actualYear.trim() !== '' && (
                <div
                  className='absolute top-2 bg-black/70 text-white text-xs font-semibold px-2 py-1 rounded backdrop-blur-sm shadow-sm transition-all duration-300 ease-out group-hover:opacity-90 left-2'
                  style={
                    {
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    return false;
                  }}
                >
                  {actualYear}
                </div>
              )}

            {(type_name ||
              (config.showRating && rate) ||
              (actualEpisodes && actualEpisodes > 1)) && (
              <div
                className='absolute top-2 right-2 flex max-w-[70%] flex-col items-end gap-1'
                style={
                  {
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  } as React.CSSProperties
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  return false;
                }}
              >
                {config.showRating && rate && (
                  <span className='flex h-7 min-w-7 items-center justify-center rounded-full bg-accent/90 px-1.5 text-xs font-bold text-white shadow-md backdrop-blur-sm'>
                    {rate}
                  </span>
                )}

                {type_name && (
                  <span className='max-w-full truncate rounded-md bg-zinc-950/80 px-2 py-1 text-[11px] font-semibold leading-none text-zinc-100 shadow-sm backdrop-blur-sm'>
                    {type_name}
                  </span>
                )}
              </div>
            )}

            {/* 豆瓣鏈接 */}
            {config.showDoubanLink &&
              actualDoubanId &&
              actualDoubanId !== 0 && (
                <CardDoubanBadge
                  isBangumi={isBangumi}
                  doubanId={actualDoubanId}
                />
              )}

            {/* 聚合播放源指示器 */}
            {isAggregate &&
              dynamicSourceNames &&
              dynamicSourceNames.length > 0 && (
                <AggregateSourcesIndicator sourceNames={dynamicSourceNames} />
              )}

            {/* UI5 Glass Panel */}
            <CardGlassPanel
              title={actualTitle}
              episodes={actualEpisodes}
              currentEpisode={currentEpisode}
              showSourceName={config.showSourceName}
              displaySourceName={displaySourceName}
              origin={origin}
              showProgress={config.showProgress}
              progress={progress}
            />
          </div>
        </div>

        {/* 操作菜单 - 支援右键和长按触发 */}
        <MobileActionSheet
          isOpen={showMobileActions}
          onClose={() => setShowMobileActions(false)}
          title={actualTitle}
          poster={processImageUrl(actualPoster)}
          actions={mobileActions}
          sources={
            isAggregate && dynamicSourceNames
              ? Array.from(new Set(dynamicSourceNames))
              : undefined
          }
          isAggregate={isAggregate}
          sourceName={source_name}
          currentEpisode={currentEpisode}
          totalEpisodes={actualEpisodes}
          origin={origin}
        />
      </>
    );
  }
);

export default memo(VideoCard);
