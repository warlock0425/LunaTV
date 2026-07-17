import { useCallback, useRef } from 'react';

import { logger } from '@/lib/logger';

/**
 * 螢幕常亮（Wake Lock）管理。
 * 播放中請求 wake lock 防止螢幕休眠，暫停/卸載時釋放。
 */
export function useWakeLock() {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen'
        );
        logger.debug('Wake Lock 已啟用');
      }
    } catch (err) {
      logger.warn('Wake Lock 請求失敗:', err);
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
