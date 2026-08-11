import { MutableRefObject, useCallback, useEffect, useRef } from 'react';

import {
  generateStorageKey,
  getAllPlayRecords,
  savePlayRecord,
  savePlayRecordOnPageExit,
} from '@/lib/db.client';
import { getStableTitle } from '@/lib/play-page-utils';
import { SearchResult } from '@/lib/types';

type ArtPlayerLike = {
  currentTime?: number;
  duration?: number;
  paused?: boolean;
};

type ExistingPlayRecord = {
  cover?: string;
  source?: string;
  vod_id?: string;
  id?: string;
};

type PlayRecordPersistenceOptions = {
  artPlayerRef: MutableRefObject<ArtPlayerLike | null>;
  currentSourceRef: MutableRefObject<string>;
  currentIdRef: MutableRefObject<string>;
  detailRef: MutableRefObject<SearchResult | null>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  videoTitleRef: MutableRefObject<string>;
  videoCoverRef: MutableRefObject<string>;
  searchTitle: string;
  getCachedDetail: (
    source: string,
    id: string
  ) => { detail: SearchResult; stale: boolean } | null;
  requestWakeLock: () => void;
  releaseWakeLock: () => void;
  cleanupPlayer: (resetCountdownUi?: boolean) => void;
};

export function usePlayRecordPersistence({
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
}: PlayRecordPersistenceOptions) {
  const saveLockRef = useRef(false);
  const lastSaveTimeRef = useRef<number>(0);

  const saveCurrentPlayProgress = useCallback(
    async (options: { pageExit?: boolean } = {}) => {
      const isPageExit = Boolean(options.pageExit);
      if (saveLockRef.current && !isPageExit) return;

      const player = artPlayerRef.current;
      const source = currentSourceRef.current;
      const id = currentIdRef.current;
      const detail = detailRef.current;
      const episodeIndex = currentEpisodeIndexRef.current;
      const stableTitle = getStableTitle(videoTitleRef.current, detail?.title);

      if (!player || !source || !id || !stableTitle || !detail?.source_name) {
        return;
      }

      const currentTime = player.currentTime || 0;
      const duration = player.duration || 0;

      if (currentTime < 1 || !duration) {
        return;
      }

      try {
        if (!isPageExit) {
          saveLockRef.current = true;
        }
        const recordKey = generateStorageKey(source, id);
        let cover =
          detail.poster ||
          videoCoverRef.current ||
          getCachedDetail(source, id)?.detail?.poster ||
          '';

        if (!cover && !isPageExit) {
          const allRecords = await getAllPlayRecords();
          const existingRecord =
            allRecords[recordKey] ||
            (Object.values(allRecords) as ExistingPlayRecord[]).find(
              (record) =>
                record &&
                record.source === source &&
                (record.vod_id === id || record.id === id)
            );
          cover = existingRecord?.cover || '';
        }

        const record = {
          title: stableTitle,
          source_name: detail.source_name,
          year: detail.year,
          cover,
          index: episodeIndex + 1,
          total_episodes: detail.episodes.length || 1,
          play_time: Math.floor(currentTime || 0),
          total_time: Math.floor(duration || 0),
          save_time: Date.now(),
          search_title: searchTitle,
        };

        if (isPageExit) {
          savePlayRecordOnPageExit(source, id, record);
        } else {
          await savePlayRecord(source, id, record);
        }

        lastSaveTimeRef.current = Date.now();
      } finally {
        if (!isPageExit) {
          saveLockRef.current = false;
        }
      }
    },
    [
      artPlayerRef,
      currentEpisodeIndexRef,
      currentIdRef,
      currentSourceRef,
      detailRef,
      getCachedDetail,
      searchTitle,
      videoCoverRef,
      videoTitleRef,
    ]
  );

  useEffect(() => {
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress({ pageExit: true });
      releaseWakeLock();
      cleanupPlayer(false);
    };

    const handlePageHide = () => {
      saveCurrentPlayProgress({ pageExit: true });
      releaseWakeLock();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress({ pageExit: true });
        releaseWakeLock();
      } else if (
        document.visibilityState === 'visible' &&
        artPlayerRef.current &&
        !artPlayerRef.current.paused
      ) {
        requestWakeLock();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    artPlayerRef,
    cleanupPlayer,
    requestWakeLock,
    releaseWakeLock,
    saveCurrentPlayProgress,
  ]);

  return { lastSaveTimeRef, saveCurrentPlayProgress };
}
