import { NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/api-rate-limit';
import {
  fetchSafeRemoteUrl,
  getSafeImageContentType,
  isSafeRemoteUrl,
  readResponseBytesWithLimit,
  RemoteResponseTooLargeError,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const IMAGE_PROXY_TIMEOUT_MS = 5_000;
const IMAGE_PROXY_MAX_BYTES = 2 * 1024 * 1024;
// 每個海報一次請求，虛擬清單快速捲動時短時間內就會累積上百次；600/分鐘
// 遠高於任何人為瀏覽速度，只擋腳本式的無限抓取。
const IMAGE_PROXY_RATE_LIMIT = 600;
const IMAGE_PROXY_RATE_WINDOW_SECONDS = 60;

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, {
    namespace: 'image-proxy',
    limit: IMAGE_PROXY_RATE_LIMIT,
    windowSeconds: IMAGE_PROXY_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  if (!isSafeRemoteUrl(imageUrl)) {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    IMAGE_PROXY_TIMEOUT_MS
  );

  try {
    const reqHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    };

    if (imageUrl.includes('doubanio.com')) {
      reqHeaders['Referer'] = 'https://movie.douban.com/';
    } else if (
      imageUrl.includes('iqiyipic.com') ||
      imageUrl.includes('iqiyi.com')
    ) {
      reqHeaders['Referer'] = 'https://www.iqiyi.com/';
    } else if (imageUrl.includes('qpic.cn') || imageUrl.includes('qq.com')) {
      reqHeaders['Referer'] = 'https://v.qq.com/';
    } else if (
      imageUrl.includes('ykimg.com') ||
      imageUrl.includes('youku.com')
    ) {
      reqHeaders['Referer'] = 'https://www.youku.com/';
    }
    // 未知圖床：刻意不帶 Referer——防盜鏈規則最普遍的設定是
    // 「空 Referer 放行、外站 Referer 阻擋」，帶圖床自身 origin
    // 反而可能不在白名單而被擋。

    const imageResponse = await fetchSafeRemoteUrl(imageUrl, {
      headers: reqHeaders,
      signal: controller.signal,
    });

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: imageResponse.statusText },
        { status: imageResponse.status }
      );
    }

    const contentType = getSafeImageContentType(
      imageResponse.headers.get('content-type')
    );
    if (!contentType) {
      imageResponse.body?.cancel();
      return NextResponse.json(
        { error: 'Unsupported image content type' },
        { status: 415 }
      );
    }

    const contentLength = Number(imageResponse.headers.get('content-length'));
    if (
      Number.isFinite(contentLength) &&
      contentLength > IMAGE_PROXY_MAX_BYTES
    ) {
      imageResponse.body?.cancel();
      return NextResponse.json(
        { error: 'Image exceeds the 2 MB limit' },
        { status: 413 }
      );
    }

    const imageData = await readResponseBytesWithLimit(
      imageResponse,
      IMAGE_PROXY_MAX_BYTES
    );

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    headers.set('Cache-Control', 'public, max-age=15720000, s-maxage=15720000');
    headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Netlify-Vary', 'query');

    return new Response(imageData, { status: 200, headers });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
    }
    if (error instanceof RemoteResponseTooLargeError) {
      return NextResponse.json(
        { error: 'Image exceeds the 2 MB limit' },
        { status: 413 }
      );
    }

    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: controller.signal.aborted ? 504 : 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
