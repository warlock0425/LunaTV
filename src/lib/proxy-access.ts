import { NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import {
  isValidApiRemoteUrl,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import {
  isWebLiveEnabled,
  peekCachedLiveChannels,
  WEB_LIVE_DISABLED_MESSAGE,
} from '@/lib/live';
import {
  isUrlAllowedForLiveProxy,
  rememberLiveProxyHost,
  vodProxyMemoryKey,
} from '@/lib/live-proxy-allowlist';
import { getServerStorageType } from '@/lib/storage-runtime';
import { isSafeRemoteUrl } from '@/lib/url-safety';

export type ProxyKind = 'live' | 'vod';

const VOD_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function parseProxyKind(raw: string | null): ProxyKind {
  return raw === 'vod' ? 'vod' : 'live';
}

export function proxyKindQuery(kind: ProxyKind): string {
  return kind === 'vod' ? '&kind=vod' : '';
}

export type ProxyAccessOk = {
  ok: true;
  kind: ProxyKind;
  source: string;
  url: string;
  ua: string;
  fetchHeaders: Record<string, string>;
  rememberHost: (fetchedUrl: string) => void;
};

export type ProxyAccessResult =
  ProxyAccessOk | { ok: false; response: NextResponse };

function jsonError(message: string, status: number): ProxyAccessResult {
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status }),
  };
}

function channelUrlsForSource(sourceKey: string): string[] {
  const cached = peekCachedLiveChannels(sourceKey);
  if (!cached) return [];
  return cached.channels.map((channel) => channel.url);
}

function mediaOriginHeaders(url: string, ua: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': ua };
  try {
    const origin = new URL(url).origin;
    headers.Referer = `${origin}/`;
    headers.Origin = origin;
  } catch {
    // 略過無法解析的 URL
  }
  return headers;
}

export async function authorizeProxyFetch(
  request: Request,
  endpoint: 'm3u8' | 'segment' | 'key'
): Promise<ProxyAccessResult> {
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo) return jsonError('Unauthorized', 401);

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('moontv-source');
  const kind = parseProxyKind(searchParams.get('kind'));

  if (!source) return jsonError('Missing moontv-source parameter', 400);
  if (!url || !isValidApiRemoteUrl(url)) {
    return jsonError('Missing or invalid url', 400);
  }
  if (!isSafeRemoteUrl(url)) return jsonError('Unsafe remote URL', 403);
  if (!isValidApiSource(source)) {
    return jsonError('Invalid source parameter', 400);
  }

  const config = await getConfig();

  if (kind === 'vod') {
    const user =
      getServerStorageType() === 'localstorage'
        ? 'localstorage'
        : authInfo.username;
    const sites = await getAvailableApiSites(user);
    if (!sites.some((site) => site.key === source)) {
      return jsonError('Source not found', 404);
    }

    const memoryKey = vodProxyMemoryKey(source);
    const allowed = isUrlAllowedForLiveProxy(memoryKey, url, '', []);
    if (endpoint !== 'm3u8' && !allowed) {
      return jsonError('URL not allowed for this video source', 403);
    }

    return {
      ok: true,
      kind,
      source,
      url,
      ua: VOD_BROWSER_UA,
      fetchHeaders: mediaOriginHeaders(url, VOD_BROWSER_UA),
      rememberHost: (fetchedUrl: string) => {
        rememberLiveProxyHost(memoryKey, fetchedUrl);
      },
    };
  }

  if (!isWebLiveEnabled(config)) {
    return jsonError(WEB_LIVE_DISABLED_MESSAGE, 403);
  }

  const liveSource = config.LiveConfig?.find(
    (item) => item.key === source && !item.disabled
  );
  if (!liveSource) return jsonError('Source not found', 404);

  if (
    !isUrlAllowedForLiveProxy(
      source,
      url,
      liveSource.url,
      channelUrlsForSource(source)
    )
  ) {
    return jsonError('URL not allowed for this live source', 403);
  }

  const ua = liveSource.ua || 'AptvPlayer/1.4.10';
  return {
    ok: true,
    kind,
    source,
    url,
    ua,
    fetchHeaders: { 'User-Agent': ua },
    rememberHost: (fetchedUrl: string) => {
      rememberLiveProxyHost(source, fetchedUrl);
    },
  };
}
