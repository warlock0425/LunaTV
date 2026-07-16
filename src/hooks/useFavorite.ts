import { useEffect, useState } from 'react';

import {
  deleteFavorite,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { logger } from '@/lib/logger';
import { getStableTitle } from '@/lib/play-page-utils';
import { SearchResult } from '@/lib/types';

import { getCachedDetail } from '@/app/play/play-page-helpers';

interface UseFavoriteOptions {
  currentSource: string | null;
  currentId: string | null;
  currentSourceRef: React.RefObject<string | null>;
  currentIdRef: React.RefObject<string | null>;
  videoTitleRef: React.RefObject<string>;
  videoCoverRef: React.RefObject<string>;
  detailRef: React.RefObject<SearchResult | null>;
  searchTitle: string;
}

export function useFavorite({
  currentSource,
  currentId,
  currentSourceRef,
  currentIdRef,
  videoTitleRef,
  videoCoverRef,
  detailRef,
  searchTitle,
}: UseFavoriteOptions) {
  const [favorited, setFavorited] = useState(false);

  // 每當 source 或 id 變化時檢查收藏狀態
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        logger.error('檢查收藏狀態失敗:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 監聽收藏資料更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, unknown>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      }
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切換收藏
  const handleToggleFavorite = async () => {
    const stableTitle = getStableTitle(
      videoTitleRef.current,
      detailRef.current?.title
    );
    if (
      !stableTitle ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: stableTitle,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover:
            detailRef.current?.poster ||
            videoCoverRef.current ||
            getCachedDetail(currentSourceRef.current, currentIdRef.current)
              ?.poster ||
            '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle || stableTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      logger.error('切換收藏失敗:', err);
    }
  };

  return { favorited, handleToggleFavorite };
}
