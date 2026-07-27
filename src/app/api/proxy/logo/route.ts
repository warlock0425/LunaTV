/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import {
  isValidApiRemoteUrl,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { getConfig } from '@/lib/config';
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');
  const source = searchParams.get('moontv-source');

  if (!imageUrl || !isValidApiRemoteUrl(imageUrl)) {
    return NextResponse.json(
      { error: 'Missing or invalid image URL' },
      { status: 400 }
    );
  }

  if (source && !isValidApiSource(source)) {
    return NextResponse.json(
      { error: 'Invalid source parameter' },
      { status: 400 }
    );
  }

  const config = await getConfig();
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  const ua = liveSource?.ua || 'AptvPlayer/1.4.10';

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
