/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import {
  isValidApiRemoteUrl,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { getConfig } from '@/lib/config';
import {
  isWebLiveEnabled,
  peekCachedLiveChannels,
  WEB_LIVE_DISABLED_MESSAGE,
} from '@/lib/live';
import { isUrlAllowedForLiveProxy } from '@/lib/live-proxy-allowlist';
import { RemoteResponseTooLargeError } from '@/lib/response-limit';
import {
  fetchSafeRemoteUrl,
  isSafeRemoteUrl,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';

const SEGMENT_FETCH_TIMEOUT_MS = 15000;
/** 單次分片上限：擋大檔濫用，仍覆蓋一般 HLS 分片與 Range 請求 */
const MAX_SEGMENT_BYTES = 50 * 1024 * 1024;

function channelUrlsForSource(sourceKey: string): string[] {
  const cached = peekCachedLiveChannels(sourceKey);
  if (!cached) return [];
  return cached.channels.map((ch) => ch.url);
}

function rejectOversizedOrLimitBody(
  response: Response,
  maxBytes: number
): Response {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    void response.body?.cancel();
    throw new RemoteResponseTooLargeError(maxBytes);
  }

  if (!response.body) {
    return response;
  }

  // 無 Content-Length 時串流計數，超過就中止（不整包進記憶體）
  if (Number.isFinite(contentLength) && contentLength > 0) {
    return response;
  }

  let total = 0;
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        controller.error(new RemoteResponseTooLargeError(maxBytes));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export async function GET(request: Request) {
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
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
  if (!isWebLiveEnabled(config)) {
    return NextResponse.json(
      { error: WEB_LIVE_DISABLED_MESSAGE },
      { status: 403 }
    );
  }
  const liveSource = config.LiveConfig?.find(
    (s: any) => s.key === source && !s.disabled
  );
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  // 目標 host 必須屬於此直播源（清單／頻道／m3u8 曾合法觸及的 CDN）
  if (
    !isUrlAllowedForLiveProxy(
      source,
      url,
      liveSource.url,
      channelUrlsForSource(source)
    )
  ) {
    return NextResponse.json(
      { error: 'URL not allowed for this live source' },
      { status: 403 }
    );
  }

  const ua = liveSource.ua || 'AptvPlayer/1.4.10';
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    SEGMENT_FETCH_TIMEOUT_MS
  );

  let response: Response | null = null;
  let responseUsed = false;

  try {
    const upstreamHeaders = new Headers({ 'User-Agent': ua });
    const range = request.headers.get('range');
    const ifRange = request.headers.get('if-range');
    if (range) upstreamHeaders.set('Range', range);
    if (ifRange) upstreamHeaders.set('If-Range', ifRange);

    response = await fetchSafeRemoteUrl(url, {
      headers: upstreamHeaders,
      signal: controller.signal,
    });
    if (!response.ok && (response.status < 400 || response.status >= 500)) {
      return NextResponse.json(
        { error: 'Failed to fetch segment' },
        { status: 500 }
      );
    }

    const limited = rejectOversizedOrLimitBody(response, MAX_SEGMENT_BYTES);
    response = limited;

    const headers = new Headers();
    const passthroughHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'etag',
      'last-modified',
    ];
    passthroughHeaders.forEach((name) => {
      const value = limited.headers.get(name);
      if (value) headers.set(name, value);
    });
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/octet-stream');
    }
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Range, Origin, Accept'
    );
    headers.set(
      'Access-Control-Expose-Headers',
      'Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified'
    );
    responseUsed = true;
    return new Response(limited.body, {
      status: limited.status,
      statusText: limited.statusText,
      headers,
    });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }
    if (error instanceof RemoteResponseTooLargeError) {
      return NextResponse.json({ error: 'Segment too large' }, { status: 413 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch segment' },
      { status: controller.signal.aborted ? 504 : 500 }
    );
  } finally {
    clearTimeout(timeoutId);
    if (response && !responseUsed) {
      void response.body?.cancel().catch(() => undefined);
    }
  }
}
