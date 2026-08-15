import { useCallback, useEffect, useRef } from 'react';

import { logger } from '@/lib/logger';

/**
 * 螢幕常亮（Wake Lock）管理。
 * 播放中請求 wake lock 防止螢幕休眠，暫停/卸載時釋放。
 */
export function useWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  // 'play' 事件每次播放都會觸發；沒有這道閘門的話每按一次播放就會多申請一個
  // sentinel，而 ref 只留得住最後一個，先前的永遠釋放不掉（暫停後螢幕仍不休眠）。
  const pendingRef = useRef(false);
  // 卸載／釋放時遞增，讓仍在飛的 request() 把遲到的 sentinel 立刻丟掉
  const generationRef = useRef(0);

  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    if (pendingRef.current) return;
    // 瀏覽器在頁面隱藏時會自動釋放 sentinel 並標記 released，此時要重新申請
    if (wakeLockRef.current && !wakeLockRef.current.released) return;

    pendingRef.current = true;
    const generation = generationRef.current;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sentinel = (await (navigator as any).wakeLock.request(
        'screen'
      )) as WakeLockSentinel;
      if (generation !== generationRef.current) {
        await sentinel.release();
        return;
      }
      wakeLockRef.current = sentinel;
      logger.debug('Wake Lock 已啟用');
    } catch (err) {
      if (generation === generationRef.current) {
        wakeLockRef.current = null;
      }
      logger.warn('Wake Lock 請求失敗:', err);
    } finally {
      if (generation === generationRef.current) {
        pendingRef.current = false;
      }
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    generationRef.current += 1;
    pendingRef.current = false;
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        logger.debug('Wake Lock 已釋放');
      }
    } catch (err) {
      logger.warn('Wake Lock 釋放失敗:', err);
    }
  }, []);

  useEffect(
    () => () => {
      void releaseWakeLock();
    },
    [releaseWakeLock]
  );

  return { requestWakeLock, releaseWakeLock };
}
