'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { PosterImage } from './PosterImage';
import { fetchDetailPoster, getCachedDetailPoster } from './utils';

export function ContinueWatchingCover({
  cover,
  title,
  source,
  id,
  onResolvedCover,
}: {
  cover?: string;
  title: string;
  source?: string;
  id?: string;
  onResolvedCover?: (cover: string) => void | Promise<void>;
}) {
  const [resolvedCover, setResolvedCover] = useState('');
  const attemptedKeyRef = useRef('');
  const onResolvedCoverRef = useRef(onResolvedCover);
  const effectiveCover = cover || resolvedCover;

  useEffect(() => {
    onResolvedCoverRef.current = onResolvedCover;
  }, [onResolvedCover]);

  const resolveCover = useCallback(async () => {
    if (!source || !id) return;

    const attemptKey = `${source}_${id}_${cover || 'empty'}`;
    if (attemptedKeyRef.current === attemptKey) return;
    attemptedKeyRef.current = attemptKey;

    const cachedPoster = getCachedDetailPoster(source, id);
    if (cachedPoster && cachedPoster !== cover) {
      setResolvedCover(cachedPoster);
      await onResolvedCoverRef.current?.(cachedPoster);
      return;
    }

    try {
      const fetchedPoster = await fetchDetailPoster(source, id);
      if (fetchedPoster && fetchedPoster !== cover) {
        setResolvedCover(fetchedPoster);
        await onResolvedCoverRef.current?.(fetchedPoster);
      }
    } catch (err) {
      console.warn('補齊播放紀錄封面失敗:', err);
    }
  }, [cover, id, source]);

  // 換片時重置補圖狀態（render 期調整狀態）
  const resetKey = `${source}_${id}_${cover || 'empty'}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setResolvedCover('');
  }

  useEffect(() => {
    attemptedKeyRef.current = '';
    if (!cover) {
      // 快取命中為同步 setState 快速路徑（刻意），其餘 setState 皆在 await 之後
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void resolveCover();
    }
  }, [cover, source, id, resolveCover]);

  return (
    <PosterImage
      src={effectiveCover}
      title={title}
      className='object-cover w-full h-full'
      onImageError={() => {
        void resolveCover();
      }}
    />
  );
}
