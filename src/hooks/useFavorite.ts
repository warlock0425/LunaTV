import { useEffect, useRef, useState } from 'react';

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
  const favoriteMutationRef = useRef(0);

  // 每當 source 或 id 變化時檢查收藏狀態
  useEffect(() => {
    let active = true;
    if (!currentSource || !currentId) {
      return () => {
        active = false;
      };
    }
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        if (active) setFavorited(fav);
      } catch (err) {
        logger.error('檢查收藏狀態失敗:', err);
      }
    })();
    return () => {
      active = false;
    };
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
    const source = currentSourceRef.current;
    const id = currentIdRef.current;
    const currentDetail = detailRef.current;
    const stableTitle = getStableTitle(
      videoTitleRef.current,
      currentDetail?.title
    );
    if (!stableTitle || !currentDetail || !source || !id) return;

    const mutationId = ++favoriteMutationRef.current;
    const canUpdateCurrentItem = () =>
      mutationId === favoriteMutationRef.current &&
      currentSourceRef.current === source &&
      currentIdRef.current === id;

    try {
      if (favorited) {
        await deleteFavorite(source, id);
        if (canUpdateCurrentItem()) setFavorited(false);
      } else {
        await saveFavorite(source, id, {
          title: stableTitle,
          source_name: currentDetail.source_name || '',
          year: currentDetail.year,
          cover:
            currentDetail.poster ||
            videoCoverRef.current ||
            getCachedDetail(source, id)?.detail?.poster ||
            '',
          total_episodes: currentDetail.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle || stableTitle,
        });
        if (canUpdateCurrentItem()) setFavorited(true);
      }
    } catch (err) {
      logger.error('切換收藏失敗:', err);
    }
  };

  return { favorited, handleToggleFavorite };
}
