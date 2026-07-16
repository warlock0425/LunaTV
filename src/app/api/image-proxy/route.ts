import { NextResponse } from 'next/server';

import {
  fetchSafeRemoteUrl,
  getSafeImageContentType,
  isSafeRemoteUrl,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const IMAGE_PROXY_TIMEOUT_MS = 15_000;
const IMAGE_PROXY_MAX_BYTES = 20 * 1024 * 1024;

function limitStreamSize(
  body: ReadableStream<Uint8Array>,
  maxBytes: number
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let received = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel('Image size limit exceeded');
          controller.error(new Error('Image size limit exceeded'));
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  if (!isSafeRemoteUrl(imageUrl)) {
    return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      IMAGE_PROXY_TIMEOUT_MS
    );
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

    let imageResponse: Response;
    try {
      imageResponse = await fetchSafeRemoteUrl(imageUrl, {
        headers: reqHeaders,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

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
        { error: 'Image exceeds the 20 MB limit' },
        { status: 413 }
      );
    }

    if (!imageResponse.body) {
      return NextResponse.json(
        { error: 'Image response has no body' },
        { status: 500 }
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    headers.set('Cache-Control', 'public, max-age=15720000, s-maxage=15720000');
    headers.set('CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=15720000');
    headers.set('Netlify-Vary', 'query');

    return new Response(
      limitStreamSize(imageResponse.body, IMAGE_PROXY_MAX_BYTES),
      {
        status: 200,
        headers,
      }
    );
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid image URL' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Error fetching image' },
      { status: 500 }
    );
  }
}
