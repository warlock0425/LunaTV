/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import {
  isValidApiRemoteUrl,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { getConfig } from '@/lib/config';
import {
  isWebLiveEnabled,
  peekCachedLiveChannels,
  WEB_LIVE_DISABLED_MESSAGE,
} from '@/lib/live';
import {
  collectLiveSourceRelatedUrls,
  isUrlAllowedForLiveProxy,
} from '@/lib/live-proxy-allowlist';
import {
  fetchSafeRemoteUrl,
  readResponseTextWithLimit,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const PRECHECK_TIMEOUT_MS = 10000;
const MAX_PRECHECK_MANIFEST_BYTES = 512 * 1024;
/** 換台／重試；與 api-search 同級 */
const LIVE_PRECHECK_RATE_LIMIT = 90;
const LIVE_PRECHECK_RATE_WINDOW_SECONDS = 60;

export async function GET(request: NextRequest) {
  // 第二道驗證：本端點會依請求參數對外發出請求，與 /api/proxy/* 同級，
  // 不可只依賴 proxy 作為唯一防線
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limited = await enforceRateLimit(request, {
    namespace: 'api-live-precheck',
    limit: LIVE_PRECHECK_RATE_LIMIT,
    windowSeconds: LIVE_PRECHECK_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('moontv-source');

  if (!source || !isValidApiSource(source)) {
    return NextResponse.json(
      { error: 'Missing or invalid moontv-source parameter' },
      { status: 400 }
    );
  }

  if (!url || !isValidApiRemoteUrl(url)) {
    return NextResponse.json(
      { error: 'Missing or invalid url' },
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

  const cached = peekCachedLiveChannels(source);
  if (
    !isUrlAllowedForLiveProxy(
      source,
      url,
      liveSource.url,
      collectLiveSourceRelatedUrls(liveSource, cached?.channels ?? [])
    )
  ) {
    return NextResponse.json(
      { error: 'URL not allowed for this live source' },
      { status: 403 }
    );
  }

  const ua = liveSource.ua || 'AptvPlayer/1.4.10';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PRECHECK_TIMEOUT_MS);

  try {
    const response = await fetchSafeRemoteUrl(url, {
      cache: 'no-cache',
      credentials: 'same-origin',
      headers: {
        'User-Agent': ua,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch', message: response.statusText },
        { status: 500 }
      );
    }

    const contentType = (
      response.headers.get('Content-Type') || ''
    ).toLowerCase();
    if (contentType.includes('video/mp4')) {
      void response.body?.cancel();
      return NextResponse.json({ success: true, type: 'mp4' }, { status: 200 });
    }
    if (contentType.includes('video/x-flv')) {
      void response.body?.cancel();
      return NextResponse.json({ success: true, type: 'flv' }, { status: 200 });
    }

    if (contentType.includes('text/html') || contentType.includes('json')) {
      void response.body?.cancel();
      return NextResponse.json(
        { error: 'Unsupported upstream content type' },
        { status: 415 }
      );
    }

    const manifest = await readResponseTextWithLimit(
      response,
      MAX_PRECHECK_MANIFEST_BYTES
    );
    if (!manifest.trimStart().startsWith('#EXTM3U')) {
      return NextResponse.json(
        { error: 'Upstream response is not an HLS manifest' },
        { status: 415 }
      );
    }

    return NextResponse.json({ success: true, type: 'm3u8' }, { status: 200 });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }

    return NextResponse.json(
      {
        error: 'Failed to fetch',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: controller.signal.aborted ? 504 : 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
