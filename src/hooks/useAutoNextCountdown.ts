import { MutableRefObject, useCallback, useRef, useState } from 'react';

import { SearchResult } from '@/lib/types';

type AutoNextCountdownOptions = {
  detailRef: MutableRefObject<SearchResult | null>;
  currentEpisodeIndexRef: MutableRefObject<number>;
  setCurrentEpisodeIndex: (index: number) => void;
};

/**
 * 自動連播倒數。切集時才讀當下索引，避免 5 秒內手動換集被拉回去。
 */
export function useAutoNextCountdown({
  detailRef,
  currentEpisodeIndexRef,
  setCurrentEpisodeIndex,
}: AutoNextCountdownOptions) {
  const [autoNextCountdown, setAutoNextCountdown] = useState(0);
  const [showCountdownOverlay, setShowCountdownOverlay] = useState(false);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoNextBusyRef = useRef(false);

  const cancelAutoNextCountdown = useCallback((resetUi = true) => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (resetUi) {
      setShowCountdownOverlay(false);
      setAutoNextCountdown(0);
    }
    autoNextBusyRef.current = false;
  }, []);

  const playNextEpisodeFromCountdown = useCallback(() => {
    const detail = detailRef.current;
    const index = currentEpisodeIndexRef.current;
    if (detail?.episodes && index < detail.episodes.length - 1) {
      setCurrentEpisodeIndex(index + 1);
    }
  }, [currentEpisodeIndexRef, detailRef, setCurrentEpisodeIndex]);

  const startAutoNextCountdown = useCallback(() => {
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
  }, [cancelAutoNextCountdown, playNextEpisodeFromCountdown]);

  return {
    autoNextCountdown,
    showCountdownOverlay,
    autoNextBusyRef,
    cancelAutoNextCountdown,
    startAutoNextCountdown,
    playNextEpisodeFromCountdown,
  };
}
