/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
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

  useEffect(() => {
    setResolvedCover('');
    attemptedKeyRef.current = '';
    if (!cover) {
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
