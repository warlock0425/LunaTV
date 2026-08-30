import { getConfig, getFreshConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  fetchSafeRemoteUrl,
  readResponseTextWithLimit,
} from '@/lib/url-safety';
import {
  consumeXmlTvBuffer,
  XmlTvParseBudget,
  XmlTvPrograms,
} from '@/lib/xmltv';

export const WEB_LIVE_DISABLED_MESSAGE = '網頁直播未開啟';

/**
 * 與前台 ENABLE_WEB_LIVE 對齊：關閉時擋瀏覽器直播頁與直播 proxy（伺服器轉發串流）。
 * 已登入的 Selene／Selene-TV 仍可讀 /api/live/sources、channels、epg（中繼資料；
 * 點播串流由客戶端直連源站）。
 */
export function isWebLiveEnabled(
  config:
    | {
        SiteConfig?: { EnableWebLive?: boolean };
      }
    | null
    | undefined
): boolean {
  return config?.SiteConfig?.EnableWebLive === true;
}

const defaultUA = 'AptvPlayer/1.4.10';
const LIVE_FETCH_TIMEOUT_MS = 10000;
const EPG_FETCH_TIMEOUT_MS = 12000;
const MAX_LIVE_PLAYLIST_BYTES = 20 * 1024 * 1024;
const MAX_EPG_BYTES = 30 * 1024 * 1024;
const MAX_EPG_PROGRAMS = 50000;

export interface LiveChannels {
  channelNumber: number;
  channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
  epgUrl: string;
  epgs: {
    [key: string]: {
      start: string;
      end: string;
      title: string;
    }[];
  };
}

const cachedLiveChannels: { [key: string]: LiveChannels } = {};
const liveChannelLoads = new Map<string, Promise<LiveChannels | null>>();
const liveRefreshes = new Map<string, Promise<number>>();

export function deleteCachedLiveChannels(key: string) {
  delete cachedLiveChannels[key];
}

/** 只讀記憶體快取，不觸發網路重整（供 proxy 白名單等熱路徑） */
export function peekCachedLiveChannels(key: string): LiveChannels | null {
  return cachedLiveChannels[key] || null;
}

export async function getCachedLiveChannels(
  key: string
): Promise<LiveChannels | null> {
  const config = await getConfig();
  const liveInfo = config.LiveConfig?.find(
    (live) => live.key === key && !live.disabled
  );
  if (!liveInfo) {
    deleteCachedLiveChannels(key);
    return null;
  }

  if (!cachedLiveChannels[key]) {
    const existingLoad = liveChannelLoads.get(key);
    if (existingLoad) return existingLoad;

    const load = (async () => {
      // 網路抓取在鎖外
      const channelNum = await refreshLiveChannels(liveInfo);
      if (channelNum === 0) return null;

      // 鎖內重讀後寫入 channelNumber，避免蓋掉其他管理端變更
      await db.withAdminConfigLock(async () => {
        const fresh = await getFreshConfig();
        const entry = fresh.LiveConfig?.find(
          (live) => live.key === key && !live.disabled
        );
        if (!entry) return;
        entry.channelNumber = channelNum;
        await db.saveAdminConfig(fresh);
        setCachedConfig(fresh);
      });
      return cachedLiveChannels[key] || null;
    })().finally(() => {
      liveChannelLoads.delete(key);
    });
    liveChannelLoads.set(key, load);
    return load;
  }
  return cachedLiveChannels[key] || null;
}

export async function refreshLiveChannels(liveInfo: {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
}): Promise<number> {
  if (liveInfo.disabled) {
    deleteCachedLiveChannels(liveInfo.key);
    return 0;
  }

  const existingRefresh = liveRefreshes.get(liveInfo.key);
  if (existingRefresh) return existingRefresh;

  const refresh = performLiveChannelRefresh(liveInfo).finally(() => {
    liveRefreshes.delete(liveInfo.key);
  });
  liveRefreshes.set(liveInfo.key, refresh);
  return refresh;
}

async function performLiveChannelRefresh(liveInfo: {
  key: string;
  name: string;
  url: string;
  ua?: string;
  epg?: string;
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
}): Promise<number> {
  if (liveInfo.disabled) {
    deleteCachedLiveChannels(liveInfo.key);
    return 0;
  }

  if (cachedLiveChannels[liveInfo.key]) {
    delete cachedLiveChannels[liveInfo.key];
  }
  const ua = liveInfo.ua || defaultUA;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LIVE_FETCH_TIMEOUT_MS);
  let data = '';
  try {
    const response = await fetchSafeRemoteUrl(liveInfo.url, {
      headers: {
        'User-Agent': ua,
      },
      signal: controller.signal,
    });
    data = await readResponseTextWithLimit(response, MAX_LIVE_PLAYLIST_BYTES);
  } finally {
    clearTimeout(timeoutId);
  }
  const result = parseM3U(liveInfo.key, data);
  const epgUrl = liveInfo.epg || result.tvgUrl;
  const epgs = await parseEpg(
    epgUrl,
    liveInfo.ua || defaultUA,
    result.channels.map((channel) => channel.tvgId).filter((tvgId) => tvgId)
  );
  if (liveInfo.disabled) {
    deleteCachedLiveChannels(liveInfo.key);
    return 0;
  }
  cachedLiveChannels[liveInfo.key] = {
    channelNumber: result.channels.length,
    channels: result.channels,
    epgUrl: epgUrl,
    epgs: epgs,
  };
  return result.channels.length;
}

async function parseEpg(
  epgUrl: string,
  ua: string,
  tvgIds: string[]
): Promise<{
  [key: string]: {
    start: string;
    end: string;
    title: string;
  }[];
}> {
  if (!epgUrl) {
    return {};
  }

  const tvgs = new Set(tvgIds);
  const result: XmlTvPrograms = {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EPG_FETCH_TIMEOUT_MS);

  try {
    const response = await fetchSafeRemoteUrl(epgUrl, {
      headers: {
        'User-Agent': ua,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return {};
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_EPG_BYTES) {
      return {};
    }

    // 使用 ReadableStream 逐行處理，避免將整個檔案載入記憶體
    const reader = response.body?.getReader();
    if (!reader) {
      return {};
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let totalBytes = 0;
    const budget: XmlTvParseBudget = {
      remainingPrograms: MAX_EPG_PROGRAMS,
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_EPG_BYTES) {
        await reader.cancel().catch(() => undefined);
        return {};
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = consumeXmlTvBuffer(buffer, tvgs, result, false, budget);
      if (budget.exceeded) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
    if (!budget.exceeded) {
      buffer += decoder.decode();
      consumeXmlTvBuffer(buffer, tvgs, result, true, budget);
    }
  } catch (error) {
    // ignore
  } finally {
    clearTimeout(timeoutId);
  }

  return result;
}

/**
 * 解析M3U檔案內容，提取頻道資訊
 * @param m3uContent M3U檔案的內容字串
 * @returns 頻道資訊陣列
 */
function parseM3U(
  sourceKey: string,
  m3uContent: string
): {
  tvgUrl: string;
  channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[];
} {
  const channels: {
    id: string;
    tvgId: string;
    name: string;
    logo: string;
    group: string;
    url: string;
  }[] = [];

  const lines = m3uContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let tvgUrl = '';
  let channelIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检查是否是 #EXTM3U 行，提取 tvg-url
    if (line.startsWith('#EXTM3U')) {
      // 支援两种格式：x-tvg-url 和 url-tvg
      const tvgUrlMatch = line.match(/(?:x-tvg-url|url-tvg)="([^"]*)"/);
      tvgUrl = tvgUrlMatch ? tvgUrlMatch[1].split(',')[0].trim() : '';
      continue;
    }

    // 检查是否是 #EXTINF 行
    if (line.startsWith('#EXTINF:')) {
      // 提取 tvg-id
      const tvgIdMatch = line.match(/tvg-id="([^"]*)"/);
      const tvgId = tvgIdMatch ? tvgIdMatch[1] : '';

      // 提取 tvg-name
      const tvgNameMatch = line.match(/tvg-name="([^"]*)"/);
      const tvgName = tvgNameMatch ? tvgNameMatch[1] : '';

      // 提取 tvg-logo
      const tvgLogoMatch = line.match(/tvg-logo="([^"]*)"/);
      const logo = tvgLogoMatch ? tvgLogoMatch[1] : '';

      // 提取 group-title
      const groupTitleMatch = line.match(/group-title="([^"]*)"/);
      const group = groupTitleMatch ? groupTitleMatch[1] : '無分組';

      // 提取標題（#EXTINF 行最後的逗號後面的內容）
      const titleMatch = line.match(/,([^,]*)$/);
      const title = titleMatch ? titleMatch[1].trim() : '';

      // 優先使用 tvg-name，如果沒有則使用標題
      const name = title || tvgName || '';

      // 检查下一行是否是URL
      if (i + 1 < lines.length && !lines[i + 1].startsWith('#')) {
        const url = lines[i + 1];

        // 只有當有名稱和 URL 時才加入結果中
        if (name && url) {
          channels.push({
            id: `${sourceKey}-${channelIndex}`,
            tvgId,
            name,
            logo,
            group,
            url,
          });
          channelIndex++;
        }

        // 跳过下一行，因为已经处理了
        i++;
      }
    }
  }

  return { tvgUrl, channels };
}

// utils/urlResolver.js
export function resolveUrl(baseUrl: string, relativePath: string) {
  try {
    // 如果已经是完整的 URL，直接返回
    if (
      relativePath.startsWith('http://') ||
      relativePath.startsWith('https://')
    ) {
      return relativePath;
    }

    // 如果是協定相對路徑 (//example.com/path)
    if (relativePath.startsWith('//')) {
      const baseUrlObj = new URL(baseUrl);
      return `${baseUrlObj.protocol}${relativePath}`;
    }

    // 使用 URL 建構函式處理相對路徑
    const baseUrlObj = new URL(baseUrl);
    const resolvedUrl = new URL(relativePath, baseUrlObj);
    return resolvedUrl.href;
  } catch (error) {
    // 降級處理
    return fallbackUrlResolve(baseUrl, relativePath);
  }
}

function fallbackUrlResolve(baseUrl: string, relativePath: string) {
  // 移除 baseUrl 末尾的檔名，保留目錄路徑
  let base = baseUrl;
  if (!base.endsWith('/')) {
    base = base.substring(0, base.lastIndexOf('/') + 1);
  }

  // 處理不同類型的相對路徑
  if (relativePath.startsWith('/')) {
    // 絕對路徑 (/path/to/file)
    const urlObj = new URL(base);
    return `${urlObj.protocol}//${urlObj.host}${relativePath}`;
  } else if (relativePath.startsWith('../')) {
    // 上級目錄相對路徑 (../path/to/file)
    const segments = base.split('/').filter((s) => s);
    const relativeSegments = relativePath.split('/').filter((s) => s);

    for (const segment of relativeSegments) {
      if (segment === '..') {
        segments.pop();
      } else if (segment !== '.') {
        segments.push(segment);
      }
    }

    const urlObj = new URL(base);
    return `${urlObj.protocol}//${urlObj.host}/${segments.join('/')}`;
  } else {
    // 當前目錄相對路徑 (file.ts 或 ./file.ts)
    const cleanRelative = relativePath.startsWith('./')
      ? relativePath.slice(2)
      : relativePath;
    return base + cleanRelative;
  }
}

// 获取 M3U8 的基础 URL
export function getBaseUrl(m3u8Url: string) {
  try {
    const url = new URL(m3u8Url);
    // 如果 URL 以 .m3u8 結尾，移除檔名
    if (url.pathname.endsWith('.m3u8')) {
      url.pathname = url.pathname.substring(
        0,
        url.pathname.lastIndexOf('/') + 1
      );
    } else if (!url.pathname.endsWith('/')) {
      url.pathname += '/';
    }
    return url.protocol + '//' + url.host + url.pathname;
  } catch (error) {
    return m3u8Url.endsWith('/') ? m3u8Url : m3u8Url + '/';
  }
}
