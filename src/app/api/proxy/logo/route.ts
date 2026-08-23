/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

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
  getSafeImageContentType,
  readResponseBytesWithLimit,
  RemoteResponseTooLargeError,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const LOGO_TIMEOUT_MS = 15_000;
const LOGO_MAX_BYTES = 10 * 1024 * 1024;
const LOGO_RATE_LIMIT = 180;
const LOGO_RATE_WINDOW_SECONDS = 60;

export async function GET(request: Request) {
  // 第二道驗證：同目錄的 key / m3u8 / segment 都有，唯獨這支漏掉
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limited = await enforceRateLimit(request, {
    namespace: 'api-proxy-logo',
    limit: LOGO_RATE_LIMIT,
    windowSeconds: LOGO_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');
  const source = searchParams.get('moontv-source');

  if (!source || !isValidApiSource(source)) {
    return NextResponse.json(
      { error: 'Missing or invalid moontv-source parameter' },
      { status: 400 }
    );
  }

  if (!imageUrl || !isValidApiRemoteUrl(imageUrl)) {
    return NextResponse.json(
      { error: 'Missing or invalid image URL' },
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
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  const cached = peekCachedLiveChannels(source);
  if (
    !isUrlAllowedForLiveProxy(
      source,
      imageUrl,
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

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOGO_TIMEOUT_MS);
    let imageResponse: Response;
    let imageBytes: Uint8Array<ArrayBuffer>;
    let contentType: string | null;
    try {
      imageResponse = await fetchSafeRemoteUrl(imageUrl, {
        cache: 'no-cache',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: {
          'User-Agent': ua,
        },
      });
      if (!imageResponse.ok) {
        imageResponse.body?.cancel();
        return NextResponse.json(
          { error: imageResponse.statusText },
          { status: imageResponse.status }
        );
      }
      // Content-Type 必須在讀取 body 之前檢查。原本順序相反，等於先把最多
      // 10 MB 的非圖片內容整個下載完才拒絕，之後的 body.cancel() 也因為
      // body 已被讀完而是空操作。
      contentType = getSafeImageContentType(
        imageResponse.headers.get('content-type')
      );
      if (!contentType) {
        imageResponse.body?.cancel();
        return NextResponse.json(
          { error: 'Unsupported image content type' },
          { status: 415 }
        );
      }
      imageBytes = await readResponseBytesWithLimit(
        imageResponse,
        LOGO_MAX_BYTES
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // 創建響應頭
    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('X-Content-Type-Options', 'nosniff');

    // 設置快取頭
    headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400'); // 快取一天

    // 直接返回圖片流
    return new Response(imageBytes, {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
    }
    if (error instanceof RemoteResponseTooLargeError) {
      return NextResponse.json(
        { error: 'Image exceeds the 10 MB limit' },
        { status: 413 }
      );
    }

    return NextResponse.json(
      { error: 'Error fetching image' },
      {
        status:
          error instanceof DOMException && error.name === 'AbortError'
            ? 504
            : 500,
      }
    );
  }
}
