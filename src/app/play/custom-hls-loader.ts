/* eslint-disable @typescript-eslint/no-explicit-any */
import Hls from 'hls.js';

import { filterAdsFromM3U8Detailed } from '@/lib/hls-ad-filter';
import { logger } from '@/lib/logger';

/**
 * 自訂 HLS Loader：攔截 manifest/level 請求，過濾 M3U8 中的廣告分段。
 * 由播放器 customType.m3u8 在去廣告開關開啟時使用。
 */
export class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
  constructor(config: any) {
    super(config);
    const load = this.load.bind(this);
    this.load = function (context: any, config: any, callbacks: any) {
      // 攔截manifest和level請求
      if (
        (context as any).type === 'manifest' ||
        (context as any).type === 'level'
      ) {
        const onSuccess = callbacks.onSuccess;
        callbacks.onSuccess = function (
          response: any,
          stats: any,
          context: any
        ) {
          // 如果是m3u8檔案，處理內容以移除廣告分段
          if (response.data && typeof response.data === 'string') {
            // 過濾掉廣告段 - 實現更精確的廣告過濾邏輯
            const filtered = filterAdsFromM3U8Detailed(response.data);
            response.data = filtered.content;
            if (filtered.removedSegments > 0) {
              logger.debug(
                `去廣告已移除 ${filtered.removedSegments} 個 HLS 廣告片段`
              );
            }
          }
          return onSuccess(response, stats, context, null);
        };
      }
      // 執行原始load方法
      load(context, config, callbacks);
    };
  }
}
