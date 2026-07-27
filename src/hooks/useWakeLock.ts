import { useCallback, useRef } from 'react';

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

  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return;
    if (pendingRef.current) return;
    // 瀏覽器在頁面隱藏時會自動釋放 sentinel 並標記 released，此時要重新申請
    if (wakeLockRef.current && !wakeLockRef.current.released) return;

    pendingRef.current = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      logger.debug('Wake Lock 已啟用');
    } catch (err) {
      wakeLockRef.current = null;
      logger.warn('Wake Lock 請求失敗:', err);
    } finally {
      pendingRef.current = false;
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
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

  return { requestWakeLock, releaseWakeLock };
}
