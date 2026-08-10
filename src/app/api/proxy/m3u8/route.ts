/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import {
  isValidApiRemoteUrl,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { getConfig } from '@/lib/config';
import { filterAdsFromM3U8Detailed } from '@/lib/hls-ad-filter';
import { getBaseUrl, peekCachedLiveChannels, resolveUrl } from '@/lib/live';
import {
  isUrlAllowedForLiveProxy,
  rememberLiveProxyHost,
} from '@/lib/live-proxy-allowlist';
import {
  fetchSafeRemoteUrl,
  isSafeRemoteUrl,
  readResponseTextWithLimit,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const M3U8_FETCH_TIMEOUT_MS = 10000;
const MAX_M3U8_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request) {
  // 1. 身份與權限驗證
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const allowCORS = searchParams.get('allowCORS') === 'true';
  const source = searchParams.get('moontv-source');
  if (!source) {
    return NextResponse.json(
      { error: 'Missing moontv-source parameter' },
      { status: 400 }
    );
  }
  if (!url || !isValidApiRemoteUrl(url)) {
    return NextResponse.json(
      { error: 'Missing or invalid url' },
      { status: 400 }
    );
  }

  // 2. 主機安全驗證 (防 SSRF)
  if (!isSafeRemoteUrl(url)) {
    return NextResponse.json({ error: 'Unsafe remote URL' }, { status: 403 });
  }

  if (!isValidApiSource(source)) {
    return NextResponse.json(
      { error: 'Invalid source parameter' },
      { status: 400 }
    );
  }

  const config = await getConfig();
  const liveSource = config.LiveConfig?.find(
    (s: any) => s.key === source && !s.disabled
  );
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  const cachedChannels = peekCachedLiveChannels(source);
  const channelUrls = cachedChannels?.channels.map((ch) => ch.url) ?? [];
  if (!isUrlAllowedForLiveProxy(source, url, liveSource.url, channelUrls)) {
    return NextResponse.json(
      { error: 'URL not allowed for this live source' },
      { status: 403 }
    );
  }

  const ua = liveSource.ua || 'AptvPlayer/1.4.10';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), M3U8_FETCH_TIMEOUT_MS);

  let response: Response | null = null;
  let responseUsed = false;

  try {
    response = await fetchSafeRemoteUrl(url, {
      cache: 'no-cache',
      credentials: 'same-origin',
      headers: {
        'User-Agent': ua,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch m3u8' },
        { status: 500 }
      );
    }

    // 不信任上游 Content-Type；不少 IPTV 來源會漏掉或錯標類型。
    // 端點只接受真正的 HLS manifest，並以大小與逾時限制完整讀取後重寫。
    const finalUrl = response.url;
    // 記錄請求與 redirect 後的 host，供後續 segment／key 白名單使用
    rememberLiveProxyHost(source, url);
    if (finalUrl) rememberLiveProxyHost(source, finalUrl);

    const m3u8Content = await readResponseTextWithLimit(
      response,
      MAX_M3U8_BYTES
    );
    responseUsed = true;
    if (!m3u8Content.trimStart().startsWith('#EXTM3U')) {
      return NextResponse.json(
        { error: 'Upstream response is not an HLS manifest' },
        { status: 415 }
      );
    }

    const filteredContent = m3u8Content.includes('#EXTINF')
      ? filterAdsFromM3U8Detailed(m3u8Content).content
      : m3u8Content;
    const baseUrl = getBaseUrl(finalUrl);
    const modifiedContent = rewriteM3U8Content(
      filteredContent,
      baseUrl,
      request,
      allowCORS,
      source
    );

    const headers = new Headers();
    headers.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Range, Origin, Accept'
    );
    headers.set('Cache-Control', 'no-cache');
    headers.set(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range'
    );

    return new Response(modifiedContent, { headers });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch m3u8' },
      { status: controller.signal.aborted ? 504 : 500 }
    );
  } finally {
    clearTimeout(timeoutId);
    // 確保 response 被正確關閉以釋放資源
    if (response && !responseUsed) {
      try {
        response.body?.cancel();
      } catch (error) {
        // 忽略關閉時的錯誤
        console.warn('Failed to close response body:', error);
      }
    }
  }
}

function rewriteM3U8Content(
  content: string,
  baseUrl: string,
  req: Request,
  allowCORS: boolean,
  source: string | null
) {
  const requestUrl = new URL(req.url);
  const forwardedProtocol = req.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    .trim();
  const referer = req.headers.get('referer');
  let refererProtocol = '';
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      refererProtocol = refererUrl.protocol.replace(':', '');
    } catch (error) {
      // ignore
    }
  }

  const protocol =
    forwardedProtocol === 'http' || forwardedProtocol === 'https'
      ? forwardedProtocol
      : refererProtocol || requestUrl.protocol.replace(':', '');
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0].trim() ||
    req.headers.get('host') ||
    requestUrl.host;
  const sourceParam = source
    ? `&moontv-source=${encodeURIComponent(source)}`
    : '';
  const proxyBase = `${protocol}://${host}/api/proxy`;

  const lines = content.split('\n');
  const rewrittenLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    // 處理 TS 片段 URL 和其他媒體檔案
    if (line && !line.startsWith('#')) {
      const resolvedUrl = resolveUrl(baseUrl, line);
      // 清單內絕對 URL 可能在別的 CDN host——必須記住，否則 segment 會 403
      if (source) rememberLiveProxyHost(source, resolvedUrl);
      const proxyUrl = allowCORS
        ? resolvedUrl
        : `${proxyBase}/segment?url=${encodeURIComponent(
            resolvedUrl
          )}${sourceParam}`;
      rewrittenLines.push(proxyUrl);
      continue;
    }

    // 處理初始化片段與 Low-Latency HLS 片段標籤中的 URI
    if (
      line.startsWith('#EXT-X-MAP:') ||
      line.startsWith('#EXT-X-PART:') ||
      line.startsWith('#EXT-X-PRELOAD-HINT:')
    ) {
      line = rewriteTagUri(
        line,
        baseUrl,
        proxyBase,
        sourceParam,
        'segment',
        source
      );
    }

    // 處理媒體清單與主清單的加密金鑰 URI
    if (
      line.startsWith('#EXT-X-KEY:') ||
      line.startsWith('#EXT-X-SESSION-KEY:')
    ) {
      line = rewriteTagUri(
        line,
        baseUrl,
        proxyBase,
        sourceParam,
        'key',
        source
      );
    }

    // 主清單中的替代音軌、字幕、I-frame 與 LL-HLS 回報都指向另一份清單。
    if (
      line.startsWith('#EXT-X-MEDIA:') ||
      line.startsWith('#EXT-X-I-FRAME-STREAM-INF:') ||
      line.startsWith('#EXT-X-IMAGE-STREAM-INF:') ||
      line.startsWith('#EXT-X-RENDITION-REPORT:')
    ) {
      line = rewriteTagUri(
        line,
        baseUrl,
        proxyBase,
        sourceParam,
        'm3u8',
        source
      );
    }

    // 處理嵌套的 M3U8 檔案 (EXT-X-STREAM-INF)
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      rewrittenLines.push(line);
      // 下一行通常是 M3U8 URL
      if (i + 1 < lines.length) {
        i++;
        const nextLine = lines[i].trim();
        if (nextLine && !nextLine.startsWith('#')) {
          const resolvedUrl = resolveUrl(baseUrl, nextLine);
          if (source) rememberLiveProxyHost(source, resolvedUrl);
          const proxyUrl = `${proxyBase}/m3u8?url=${encodeURIComponent(
            resolvedUrl
          )}${sourceParam}`;
          rewrittenLines.push(proxyUrl);
        } else {
          rewrittenLines.push(nextLine);
        }
      }
      continue;
    }

    rewrittenLines.push(line);
  }

  return rewrittenLines.join('\n');
}

function rewriteTagUri(
  line: string,
  baseUrl: string,
  proxyBase: string,
  sourceParam: string,
  endpoint: 'segment' | 'key' | 'm3u8',
  source: string | null
) {
  const uriMatch = line.match(/\bURI=(["'])(.*?)\1/i);
  if (uriMatch) {
    const quote = uriMatch[1];
    const originalUri = uriMatch[2];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    // 與媒體行相同：tag 裡的 URI 也可能跨 CDN
    if (source) rememberLiveProxyHost(source, resolvedUrl);
    const proxyUrl = `${proxyBase}/${endpoint}?url=${encodeURIComponent(
      resolvedUrl
    )}${sourceParam}`;
    return line.replace(uriMatch[0], `URI=${quote}${proxyUrl}${quote}`);
  }
  return line;
}
