/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/exhaustive-deps,@typescript-eslint/no-empty-function,no-console */

import {
  Clapperboard,
  ExternalLink,
  Heart,
  Link,
  PlayCircleIcon,
  Radio,
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
    // 獲取收藏狀態（搜尋結果頁面不檢查）
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
        // 立即顯示菜單，避免等待資料加載導致動畫卡頓
        setShowMobileActions(true);

        // 異步檢查收藏狀態，不阻塞菜單顯示
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
          showHeart: true, // 移動端菜單中需要顯示收藏選項
          showCheckCircle: false,
          showDoubanLink: true, // 移動端菜單中顯示豆瓣鏈接
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

    // 移動端操作菜單配置
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

      // 聚合源資訊 - 直接在菜單中展示，不需要單獨的操作項

      // 收藏/取消收藏操作
      if (config.showHeart && from !== 'douban' && actualSource && actualId) {
        const currentFavorited =
          from === 'search' ? searchFavorited : favorited;

        if (from === 'search') {
          // 搜尋結果：根據加載狀態顯示不同的選項
          if (searchFavorited !== null) {
            // 已加載完成，顯示實際的收藏狀態
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
            // 正在加載中，顯示占位項
            actions.push({
              id: 'favorite-loading',
              label: '收藏加載中...',
              icon: <Heart size={20} />,
              onClick: () => {}, // 加載中時不響應點擊
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
          className='group relative w-full rounded-lg bg-transparent cursor-pointer transition-all duration-300 ease-out hover:scale-[1.05] hover:-translate-y-1 hover:shadow-xl hover:shadow-accent/20 hover:z-[500] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#0b0c10]'
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          role='button'
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
              // 禁用右鍵菜單和長按菜單
              pointerEvents: 'auto',
            } as React.CSSProperties
          }
          onContextMenu={(e) => {
            // 阻止預設右鍵菜單
            e.preventDefault();
            e.stopPropagation();

            // 右鍵彈出操作菜單
            setShowMobileActions(true);

            // 異步檢查收藏狀態，不阻塞菜單顯示
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
                  <Trash2
                    onClick={handleDeleteRecord}
                    size={20}
                    className='text-white transition-all duration-300 ease-out hover:stroke-red-500 hover:scale-[1.1]'
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
                )}
                {config.showHeart && from !== 'search' && (
                  <Heart
                    onClick={handleToggleFavorite}
                    size={20}
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
                    onContextMenu={(e) => {
                      e.preventDefault();
                      return false;
                    }}
                  />
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
                <a
                  href={
                    isBangumi
                      ? `https://bgm.tv/subject/${actualDoubanId.toString()}`
                      : `https://movie.douban.com/subject/${actualDoubanId.toString()}`
                  }
                  target='_blank'
                  rel='noopener noreferrer'
                  onClick={(e) => e.stopPropagation()}
                  className='absolute top-2 left-2 opacity-0 -translate-x-2 transition-all duration-300 ease-in-out delay-100 sm:group-hover:opacity-100 sm:group-hover:translate-x-0'
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
                  <div
                    className='bg-accent text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-md hover:bg-[#cc3256] hover:scale-[1.1] transition-all duration-300 ease-out'
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
                    <Link
                      size={16}
                      style={
                        {
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                          pointerEvents: 'none',
                        } as React.CSSProperties
                      }
                    />
                  </div>
                </a>
              )}

            {/* 聚合播放源指示器 */}
            {isAggregate &&
              dynamicSourceNames &&
              dynamicSourceNames.length > 0 &&
              (() => {
                const uniqueSources = Array.from(new Set(dynamicSourceNames));
                const sourceCount = uniqueSources.length;

                return (
                  <div
                    className='absolute bottom-2 right-2 transition-all duration-300 ease-in-out delay-75 z-[60]'
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
                    <div
                      className='relative group/sources'
                      style={
                        {
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties
                      }
                    >
                      <div
                        className='bg-accent/90 backdrop-blur-sm border border-white/20 text-white text-xs font-bold w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center shadow-lg hover:bg-accent hover:scale-[1.1] transition-all duration-300 ease-out cursor-pointer'
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
                        {sourceCount}
                      </div>

                      {/* 播放源詳情懸浮框 */}
                      {(() => {
                        // 優先顯示的播放源（常見的主流平臺）
                        const prioritySources = [
                          '愛奇藝',
                          '騰訊影片',
                          '優酷',
                          '芒果TV',
                          '嗶哩嗶哩',
                          'Netflix',
                          'Disney+',
                        ];

                        // 按優先級排序播放源
                        const sortedSources = uniqueSources.sort((a, b) => {
                          const aIndex = prioritySources.indexOf(a);
                          const bIndex = prioritySources.indexOf(b);
                          if (aIndex !== -1 && bIndex !== -1)
                            return aIndex - bIndex;
                          if (aIndex !== -1) return -1;
                          if (bIndex !== -1) return 1;
                          return a.localeCompare(b);
                        });

                        const maxDisplayCount = 6; // 最多顯示6個
                        const displaySources = sortedSources.slice(
                          0,
                          maxDisplayCount
                        );
                        const hasMore = sortedSources.length > maxDisplayCount;
                        const remainingCount =
                          sortedSources.length - maxDisplayCount;

                        return (
                          <div
                            className='absolute bottom-full mb-2 opacity-0 invisible group-hover/sources:opacity-100 group-hover/sources:visible transition-all duration-200 ease-out delay-100 pointer-events-none z-50 right-0 sm:right-0 -translate-x-0 sm:translate-x-0'
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
                            <div
                              className='bg-zinc-900/95 backdrop-blur-sm text-white text-xs sm:text-xs rounded-lg shadow-xl border border-white/15 p-1.5 sm:p-2 min-w-[100px] sm:min-w-[120px] max-w-[140px] sm:max-w-[200px] overflow-hidden'
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
                              {/* 單列佈局 */}
                              <div className='space-y-0.5 sm:space-y-1'>
                                {displaySources.map((sourceName, index) => (
                                  <div
                                    key={index}
                                    className='flex items-center gap-1 sm:gap-1.5'
                                  >
                                    <div className='w-0.5 h-0.5 sm:w-1 sm:h-1 bg-blue-400 rounded-full flex-shrink-0'></div>
                                    <span
                                      className='truncate text-[11px] sm:text-xs font-medium leading-tight text-zinc-200'
                                      title={sourceName}
                                    >
                                      {sourceName}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              {/* 顯示更多提示 */}
                              {hasMore && (
                                <div className='mt-1 sm:mt-2 pt-1 sm:pt-1.5 border-t border-zinc-700/50'>
                                  <div className='flex items-center justify-center text-zinc-400'>
                                    <span className='text-[11px] sm:text-xs font-medium text-zinc-300'>
                                      +{remainingCount} 播放源
                                    </span>
                                  </div>
                                </div>
                              )}

                              {/* 小箭頭 */}
                              <div className='absolute top-full right-2 sm:right-3 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] sm:border-l-[6px] sm:border-r-[6px] sm:border-t-[6px] border-transparent border-t-zinc-800/90'></div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}

            {/* UI5 Glass Panel */}
            <div
              className='absolute inset-x-0 bottom-0 flex flex-col justify-end pointer-events-none'
              style={
                {
                  background: 'transparent',
                  paddingTop: '2rem',
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
              <div
                className='w-full bg-gradient-to-t from-black via-black/80 to-transparent pt-6 pb-2 px-2.5 flex flex-col gap-1 pointer-events-auto'
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
                {/* 標題 */}
                <div
                  className='relative'
                  style={
                    {
                      WebkitUserSelect: 'none',
                      userSelect: 'none',
                      WebkitTouchCallout: 'none',
                    } as React.CSSProperties
                  }
                >
                  <span
                    className='block text-sm font-bold truncate text-white transition-colors duration-300 ease-in-out group-hover:text-white peer drop-shadow-md tracking-wide'
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
                    {actualTitle}
                  </span>
                  {/* 自定義 tooltip */}
                  <div
                    className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-zinc-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap z-[600] pointer-events-none'
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
                    {actualTitle}
                    <div
                      className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-zinc-800'
                      style={
                        {
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        } as React.CSSProperties
                      }
                    ></div>
                  </div>
                </div>

                {/* 標籤區塊 (集數 + 片源) */}
                <div
                  className='flex items-center gap-1.5 overflow-hidden w-full'
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
                  {actualEpisodes && actualEpisodes > 1 && (
                    <span
                      className='shrink-0 rounded-full bg-zinc-800 text-white px-2 py-0.5 text-[10px] font-medium tracking-wide'
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
                      {currentEpisode
                        ? `第 ${currentEpisode}/${actualEpisodes} 集`
                        : `全 ${actualEpisodes} 集`}
                    </span>
                  )}
                  {config.showSourceName && displaySourceName && (
                    <span
                      title={displaySourceName}
                      className='truncate text-[10px] font-medium text-white bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-sm tracking-wide inline-flex items-center gap-1 shrink-1'
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
                      {origin === 'live' ? (
                        <Radio
                          size={10}
                          className='shrink-0 text-white opacity-80'
                        />
                      ) : (
                        <Clapperboard
                          size={10}
                          className='shrink-0 text-white opacity-80'
                        />
                      )}
                      {displaySourceName}
                    </span>
                  )}
                </div>
              </div>

              {/* 進度條 (直接貼在最底部) */}
              {config.showProgress && progress !== undefined && (
                <div
                  className='h-0.5 w-full bg-zinc-800 overflow-hidden relative z-[50] pointer-events-none'
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
                  <div
                    className='h-full bg-accent transition-all duration-500 ease-out'
                    style={
                      {
                        width: `${progress}%`,
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
            </div>
          </div>
        </div>

        {/* 操作菜单 - 支持右键和长按触发 */}
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
