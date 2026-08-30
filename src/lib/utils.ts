import he from 'he';

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
 * 年份顯示值；沒有可用年份時回傳空字串。
 *
 * 上游抓不到年份時 downstream 會填入字串 'unknown'（見 lib/downstream.ts），
 * 舊紀錄也可能留有 'undefined' / 'null'。這些是內部哨兵值，不該顯示給使用者，
 * 但因為都是非空字串，用 `year && ...` 這種判斷是擋不住的。
 */
export function formatYear(year?: string): string {
  const value = (year || '').trim();
  if (
    !value ||
    value === 'unknown' ||
    value === 'undefined' ||
    value === 'null'
  ) {
    return '';
  }
  return value;
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
  return getQualityFromWidth(pickBestM3u8Variant(m3u8Content).width);
}

export function getBestM3u8VariantUri(m3u8Content: string): string {
  return pickBestM3u8Variant(m3u8Content).uri;
}

export function resolvePlaylistUrl(baseUrl: string, ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function isM3u8Ref(value: string): boolean {
  return /\.m3u8($|\?)/i.test(value);
}

export function getFirstM3u8MediaSegmentUrl(
  m3u8Content: string,
  playlistUrl: string
): string | null {
  const lines = m3u8Content.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    if (isM3u8Ref(line)) continue;
    return resolvePlaylistUrl(playlistUrl, line);
  }
  return null;
}

function pickBestM3u8Variant(m3u8Content: string): {
  width: number;
  bandwidth: number;
  uri: string;
} {
  const lines = m3u8Content.split(/\r?\n/).map((line) => line.trim());
  let bestWidth = 0;
  let bestBandwidth = 0;
  let bestUri = '';

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

    const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
    const width = resolutionMatch ? Number(resolutionMatch[1]) : 0;
    const bandwidth = bandwidthMatch ? Number(bandwidthMatch[1]) : 0;
    const nextLine = lines[index + 1];
    const uri = nextLine && !nextLine.startsWith('#') ? nextLine : '';

    if (
      width > bestWidth ||
      (width === bestWidth && bandwidth > bestBandwidth)
    ) {
      bestWidth = width;
      bestBandwidth = bandwidth;
      bestUri = uri;
    }
  }

  return { width: bestWidth, bandwidth: bestBandwidth, uri: bestUri };
}

function formatLoadSpeed(bytes: number, durationMs: number): string {
  if (bytes <= 0 || durationMs <= 0) return '未知';
  const kbps = bytes / 1024 / (durationMs / 1000);
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${kbps.toFixed(1)} KB/s`;
}

const SPEED_TEST_TIMEOUT_MS = 2500;
const SPEED_TEST_MAX_BYTES = 512 * 1024;

async function readResponsePrefix(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal
): Promise<number> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    return buffer.byteLength;
  }

  const reader = response.body.getReader();
  let received = 0;
  try {
    while (received < maxBytes) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      received += value?.byteLength || 0;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  return received;
}

async function probeM3u8ByFetch(
  m3u8Url: string,
  signal?: AbortSignal
): Promise<{
  quality: string;
  loadSpeed: string;
  pingTime: number;
}> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), SPEED_TEST_TIMEOUT_MS);

  if (signal?.aborted) {
    clearTimeout(timeoutId);
    throw new DOMException('Aborted', 'AbortError');
  }
  signal?.addEventListener('abort', abortFromParent, { once: true });

  try {
    const pingStart =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const playlistResponse = await fetch(m3u8Url, {
      signal: controller.signal,
    });
    const pingTime = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
        pingStart
    );
    if (!playlistResponse.ok) {
      throw new Error(`Failed to load playlist: ${playlistResponse.status}`);
    }

    const playlistText = await playlistResponse.text();
    const quality = getBestM3u8VariantQuality(playlistText) || '未知';
    let mediaPlaylistUrl = m3u8Url;
    let mediaPlaylistText = playlistText;
    const variantUri = getBestM3u8VariantUri(playlistText);
    if (variantUri) {
      mediaPlaylistUrl = resolvePlaylistUrl(m3u8Url, variantUri);
      const mediaResponse = await fetch(mediaPlaylistUrl, {
        signal: controller.signal,
      });
      if (mediaResponse.ok) {
        mediaPlaylistText = await mediaResponse.text();
      }
    }

    const segmentUrl = getFirstM3u8MediaSegmentUrl(
      mediaPlaylistText,
      mediaPlaylistUrl
    );
    let loadSpeed = '未知';
    if (segmentUrl) {
      const speedStart =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const segmentResponse = await fetch(segmentUrl, {
        signal: controller.signal,
      });
      if (segmentResponse.ok) {
        const received = await readResponsePrefix(
          segmentResponse,
          SPEED_TEST_MAX_BYTES,
          controller.signal
        );
        const speedEnd =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        loadSpeed = formatLoadSpeed(received, speedEnd - speedStart);
      }
    }

    return {
      quality: quality || '未知',
      loadSpeed,
      pingTime,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (signal?.aborted) throw error;
      throw new Error('Timeout loading video metadata');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

/**
 * 先 fetch 解析播放清單（快、畫質準）。被 CORS 擋住時改走上游同款 hls.js 探針，
 * 與播放器同一條載入路徑，能播的源盡量能量到。
 */
export async function getVideoResolutionFromM3u8(
  m3u8Url: string,
  signal?: AbortSignal
): Promise<{
  quality: string; // 如 720p、1080p 等
  loadSpeed: string; // 自動轉換為 KB/s 或 MB/s
  pingTime: number; // 網路延遲（毫秒）
}> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  try {
    return await probeM3u8ByFetch(m3u8Url, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    if (typeof document === 'undefined') {
      throw new Error(
        `Error getting video resolution: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    try {
      // node16 動態相對 import 必須帶 .js；@/ 別名在此解析不到
      const { probeM3u8ByHls } = await import('./m3u8-hls-probe.js');
      return await probeM3u8ByHls(m3u8Url, signal);
    } catch (hlsError) {
      if (signal?.aborted) throw hlsError;
      throw new Error(
        `Error getting video resolution: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
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
