/* eslint-disable no-console */
import he from 'he';
import type { ErrorData, Events, FragLoadedData } from 'hls.js';

type DoubanImageProxyType =
  | 'server'
  | 'cmliussss-cdn-tencent'
  | 'cmliussss-cdn-ali'
  | 'custom'
  | 'direct'
  | 'img3';

function isValidImageProxyType(val: unknown): val is DoubanImageProxyType {
  return (
    typeof val === 'string' &&
    [
      'server',
      'cmliussss-cdn-tencent',
      'cmliussss-cdn-ali',
      'custom',
      'direct',
      'img3',
    ].includes(val)
  );
}

export function getDoubanImageProxyConfig(): {
  proxyType:
    'server' | 'cmliussss-cdn-tencent' | 'cmliussss-cdn-ali' | 'custom';
  proxyUrl: string;
} {
  let doubanImageProxyType: DoubanImageProxyType = 'cmliussss-cdn-tencent';
  let doubanImageProxy = '';

  if (typeof window !== 'undefined') {
    const rawType =
      localStorage.getItem('doubanImageProxyType') ||
      window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY_TYPE;
    if (isValidImageProxyType(rawType)) {
      doubanImageProxyType = rawType;
    }

    doubanImageProxy =
      localStorage.getItem('doubanImageProxyUrl') ||
      window.RUNTIME_CONFIG?.DOUBAN_IMAGE_PROXY ||
      '';
  }

  // 相容歷史資料：直連和豆瓣官方精品 CDN 統一使用伺服器代理
  if (doubanImageProxyType === 'direct' || doubanImageProxyType === 'img3') {
    doubanImageProxyType = 'server';
  }
  return {
    proxyType: doubanImageProxyType,
    proxyUrl: doubanImageProxy,
  };
}

/**
 * 伺服器端圖片代理網址。
 * 供直連失敗時的 onError 備援，以及 http 圖源避免 mixed content。
 */
export function getProxiedImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;
  const trimmed = originalUrl.trim();
  // 容錯：補全 protocol-relative（//host/path）網址
  const absolute = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;
  return `/api/image-proxy?url=${encodeURIComponent(absolute)}`;
}

export function processImageUrl(originalUrl: string): string {
  if (!originalUrl) return originalUrl;
  originalUrl = originalUrl.trim();

  // 如果是本地路徑或 base64/blob，直接返回
  if (
    (originalUrl.startsWith('/') && !originalUrl.startsWith('//')) ||
    originalUrl.startsWith('data:') ||
    originalUrl.startsWith('blob:')
  ) {
    return originalUrl;
  }

  // 處理豆瓣以外的其他外部圖片 URL（多為 CMS 片源封面）
  if (!originalUrl.includes('doubanio.com')) {
    // 針對已知防盜鏈非常嚴格，會回傳黑圖的圖床，強制走伺服器代理
    const STRICT_HOTLINK_HOSTS = [
      'iqiyipic.com',
      'iqiyi.com',
      'qpic.cn',
      'qq.com',
      'ykimg.com',
      'youku.com',
    ];
    if (STRICT_HOTLINK_HOSTS.some((host) => originalUrl.includes(host))) {
      return getProxiedImageUrl(originalUrl);
    }

    // 直連優先：讓瀏覽器用「觀眾自己的 IP」載圖（搭配 <img referrerPolicy='no-referrer'>）。
    // 伺服器代理僅作 onError 備援——自架主機（尤其海外 VPS）的出口 IP
    // 常被中國圖床封鎖，強制走代理反而整批破圖。
    if (originalUrl.startsWith('https://') || originalUrl.startsWith('//')) {
      return originalUrl;
    }
    // http 圖源在 https 站點會被瀏覽器擋 mixed content，只能走代理
    if (originalUrl.startsWith('http://')) {
      return getProxiedImageUrl(originalUrl);
    }
    return originalUrl;
  }

  const { proxyType, proxyUrl } = getDoubanImageProxyConfig();
  switch (proxyType) {
    case 'server':
      return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
    case 'cmliussss-cdn-tencent':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.net'
      );
    case 'cmliussss-cdn-ali':
      return originalUrl.replace(
        /img\d+\.doubanio\.com/g,
        'img.doubanio.cmliussss.com'
      );
    case 'custom':
      return `${proxyUrl}${encodeURIComponent(originalUrl)}`;
    default:
      return `/api/image-proxy?url=${encodeURIComponent(originalUrl)}`;
  }
}

/**
 * 從 m3u8 地址取得影片質量等級和網路資訊
 * @param m3u8Url m3u8 播放列表的 URL
 * @returns Promise<{quality: string, loadSpeed: string, pingTime: number}> 影片質量等級和網路資訊
 */
export function getQualityFromWidth(width: number): string {
  if (width >= 3840) return '4K';
  if (width >= 2560) return '2K';
  if (width >= 1920) return '1080p';
  if (width >= 1280) return '720p';
  if (width >= 854) return '480p';
  if (width > 0) return 'SD';
  return '';
}

export function getBestM3u8VariantQuality(m3u8Content: string): string {
  const lines = m3u8Content.split(/\r?\n/);
  let bestWidth = 0;
  let bestBandwidth = 0;

  for (const line of lines) {
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
    const width = resolutionMatch ? Number(resolutionMatch[1]) : 0;
    const bandwidth = bandwidthMatch ? Number(bandwidthMatch[1]) : 0;

    if (
      width > bestWidth ||
      (width === bestWidth && bandwidth > bestBandwidth)
    ) {
      bestWidth = width;
      bestBandwidth = bandwidth;
    }
  }

  return getQualityFromWidth(bestWidth);
}

export async function getVideoResolutionFromM3u8(
  m3u8Url: string,
  signal?: AbortSignal
): Promise<{
  quality: string; // 如 720p、1080p 等
  loadSpeed: string; // 自動轉換為 KB/s 或 MB/s
  pingTime: number; // 網路延遲（毫秒）
}> {
  try {
    // hls.js 體積大（gzip 後 ~150KB），動態載入以免經由 utils.ts 被打進
    // 全站共用 bundle；只有實際執行測速時才需要它
    // 型別斷言回靜態解析的 CJS 型別，避免 node16 模組解析下
    // ESM/CJS 兩套名義型別（如 enum）互不相容
    const { default: Hls } =
      (await import('hls.js')) as unknown as typeof import('hls.js');

    // 直接使用 m3u8 URL 作為影片源，避免 CORS 問題
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'metadata';

      // 測量網路延遲（ping 時間） - 使用 m3u8 URL 而不是 ts 檔案
      const pingStart = performance.now();
      let pingTime = 0;
      let playlistQualityHint = '';
      const requestController = new AbortController();

      // 測量 ping 時間（使用 m3u8 URL）
      fetch(m3u8Url, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: requestController.signal,
      })
        .then(() => {
          pingTime = performance.now() - pingStart;
        })
        .catch(() => {
          pingTime = performance.now() - pingStart; // 記錄到失敗為止的時間
        });

      // 固定使用 hls.js 載入
      fetch(m3u8Url, { signal: requestController.signal })
        .then((response) => (response.ok ? response.text() : ''))
        .then((content) => {
          playlistQualityHint = getBestM3u8VariantQuality(content);
        })
        .catch(() => {
          // ignore
        });

      const hls = new Hls();
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const abortFromParent = () =>
        rejectOnce(new DOMException('Aborted', 'AbortError'));

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        signal?.removeEventListener('abort', abortFromParent);
        requestController.abort();
        hls.destroy();
        video.remove();
      };

      function resolveOnce(value: {
        quality: string;
        loadSpeed: string;
        pingTime: number;
      }) {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      }

      function rejectOnce(error: Error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }

      if (signal?.aborted) {
        rejectOnce(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal?.addEventListener('abort', abortFromParent, { once: true });

      // 設定超時處理
      timeout = setTimeout(() => {
        rejectOnce(new Error('Timeout loading video metadata'));
      }, 2500);

      video.onerror = () => {
        rejectOnce(new Error('Failed to load video metadata'));
      };

      let actualLoadSpeed = '未知';
      let hasSpeedCalculated = false;
      let hasMetadataLoaded = false;

      let fragmentStartTime = 0;

      // 檢查是否可以返回結果
      const checkAndResolve = () => {
        if (
          hasMetadataLoaded &&
          (hasSpeedCalculated || actualLoadSpeed !== '未知')
        ) {
          const width = video.videoWidth;
          if (width && width > 0) {
            // 根據影片寬度判斷影片質量等級，使用經典解析度的寬度作為分割點
            const quality = getQualityFromWidth(width);

            resolveOnce({
              quality,
              loadSpeed: actualLoadSpeed,
              pingTime: Math.round(pingTime),
            });
          } else {
            // webkit 無法取得尺寸，直接返回
            resolveOnce({
              quality: playlistQualityHint || '未知',
              loadSpeed: actualLoadSpeed,
              pingTime: Math.round(pingTime),
            });
          }
        }
      };

      // 監聽片段載入開始
      hls.on(Hls.Events.FRAG_LOADING, () => {
        fragmentStartTime = performance.now();
      });

      // 監聽片段載入完成，只需首個分片即可計算速度
      hls.on(
        Hls.Events.FRAG_LOADED,
        (event: Events.FRAG_LOADED, data: FragLoadedData) => {
          if (
            fragmentStartTime > 0 &&
            data &&
            data.payload &&
            !hasSpeedCalculated
          ) {
            const loadTime = performance.now() - fragmentStartTime;
            const size = data.payload.byteLength || 0;

            if (loadTime > 0 && size > 0) {
              const speedKBps = size / 1024 / (loadTime / 1000);

              // 立即計算速度，無需等待更多分片
              const avgSpeedKBps = speedKBps;

              if (avgSpeedKBps >= 1024) {
                actualLoadSpeed = `${(avgSpeedKBps / 1024).toFixed(1)} MB/s`;
              } else {
                actualLoadSpeed = `${avgSpeedKBps.toFixed(1)} KB/s`;
              }
              hasSpeedCalculated = true;
              checkAndResolve(); // 嘗試返回結果
            }
          }
        }
      );

      hls.loadSource(m3u8Url);
      hls.attachMedia(video);

      // 監聽 hls.js 錯誤
      hls.on(Hls.Events.ERROR, (event: Events.ERROR, data: ErrorData) => {
        console.error('HLS 錯誤:', data);
        if (data.fatal) {
          rejectOnce(new Error(`HLS 播放失敗: ${data.type}`));
        }
      });

      // 監聽影片元數據載入完成
      video.onloadedmetadata = () => {
        hasMetadataLoaded = true;
        checkAndResolve(); // 嘗試返回結果
      };
    });
  } catch (error) {
    throw new Error(
      `Error getting video resolution: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function cleanHtmlTags(text: string): string {
  if (!text) return '';

  const cleanedText = text
    .replace(/<[^>]+>/g, '\n') // 將 HTML 標籤替換為換行
    .replace(/\n+/g, '\n') // 將多個連續換行合併為一個
    .replace(/[ \t]+/g, ' ') // 將多個連續空格和制表符合併為一個空格，但保留換行符
    .replace(/^\n+|\n+$/g, '') // 去掉首尾換行
    .trim(); // 去掉首尾空格

  // 使用 he 庫解碼 HTML 實體
  return he.decode(cleanedText);
}
