/**
 * 直播 proxy（m3u8 / segment / key）允許抓取的主機白名單。
 *
 * 攻擊面：已登入 + 任一啟用直播源 key，即可讓伺服器去抓任意公網 URL
 * （頻寬／連線濫用）。SSRF 私網擋了，但對「任意 CDN 大檔」無效。
 *
 * 允許來源：
 * 1) 直播源 M3U 位址的 host
 * 2) 記憶體中已快取的頻道 stream URL host
 * 3) 該源經 m3u8 proxy 成功抓過的 host（含 redirect 後 finalUrl）
 *
 * (3) 讓多 CDN／重導向仍可播，同時任意 host 必須先經過「屬於該源的清單」
 * 才能被記住。
 */

import { setBoundedMapValue } from './bounded-map';

const REMEMBERED_TTL_MS = 60 * 60 * 1000;
const MAX_SOURCES = 200;
const MAX_HOSTS_PER_SOURCE = 100;

type RememberedEntry = {
  hosts: Map<string, number>; // host -> expiresAt
};

const rememberedBySource = new Map<string, RememberedEntry>();

/** 點播代理的記憶體白名單與直播源隔離。 */
export function vodProxyMemoryKey(sourceKey: string): string {
  return `vod:${sourceKey}`;
}

export function getHostnameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return null;
  }
}

/** 測試用：清空記憶體白名單 */
export function clearLiveProxyRememberedHosts(): void {
  rememberedBySource.clear();
}

/**
 * 記錄該直播源曾合法觸及的 host（m3u8 抓取成功後呼叫）。
 * 過期與數量有上限，避免記憶體被灌爆。
 */
export function rememberLiveProxyHost(sourceKey: string, url: string): void {
  const host = getHostnameFromUrl(url);
  if (!host || !sourceKey) return;

  const now = Date.now();
  let entry = rememberedBySource.get(sourceKey);
  if (!entry) {
    entry = { hosts: new Map() };
    setBoundedMapValue(rememberedBySource, sourceKey, entry, MAX_SOURCES);
  }

  // 清過期
  for (const [h, exp] of Array.from(entry.hosts.entries())) {
    if (exp <= now) entry.hosts.delete(h);
  }

  entry.hosts.delete(host);
  entry.hosts.set(host, now + REMEMBERED_TTL_MS);
  while (entry.hosts.size > MAX_HOSTS_PER_SOURCE) {
    const oldest = entry.hosts.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    entry.hosts.delete(oldest);
  }
}

/** 直播源本體、EPG、頻道串流與台標，供 logo／precheck 白名單使用 */
export function collectLiveSourceRelatedUrls(
  liveSource: { url?: string; epg?: string },
  channels: Iterable<{ url?: string; logo?: string }> = []
): string[] {
  const urls: string[] = [];
  if (liveSource.url) urls.push(liveSource.url);
  if (liveSource.epg) urls.push(liveSource.epg);
  for (const channel of channels) {
    if (channel.url) urls.push(channel.url);
    if (channel.logo) urls.push(channel.logo);
  }
  return urls;
}

export function collectStaticLiveProxyHosts(
  liveSourceUrl: string,
  channelUrls: Iterable<string> = []
): Set<string> {
  const hosts = new Set<string>();
  const sourceHost = getHostnameFromUrl(liveSourceUrl);
  if (sourceHost) hosts.add(sourceHost);
  for (const channelUrl of channelUrls) {
    const host = getHostnameFromUrl(channelUrl);
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * 目標 URL 的 host 是否屬於此直播源（靜態清單 ∪ 記憶體）。
 */
export function isUrlAllowedForLiveProxy(
  sourceKey: string,
  targetUrl: string,
  liveSourceUrl: string,
  channelUrls: Iterable<string> = []
): boolean {
  const targetHost = getHostnameFromUrl(targetUrl);
  if (!targetHost) return false;

  const allowed = collectStaticLiveProxyHosts(liveSourceUrl, channelUrls);
  const remembered = rememberedBySource.get(sourceKey);
  if (remembered) {
    const now = Date.now();
    for (const [host, exp] of Array.from(remembered.hosts.entries())) {
      if (exp <= now) {
        remembered.hosts.delete(host);
        continue;
      }
      allowed.add(host);
    }
  }

  return allowed.has(targetHost);
}
