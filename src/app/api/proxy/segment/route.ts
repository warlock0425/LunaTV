/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import {
  isValidApiRemoteUrl,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { getAuthInfoFromCookie, verifyAuthSession } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  fetchSafeRemoteUrl,
  isSafeRemoteUrl,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  // 1. 身份與權限驗證
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storageType =
    process.env.STORAGE_TYPE ||
    process.env.NEXT_PUBLIC_STORAGE_TYPE ||
    'localstorage';
  let isAuthorized = false;

  if (storageType === 'localstorage') {
    if (authInfo.signature) {
      isAuthorized = await verifyAuthSession(
        authInfo,
        'localstorage',
        process.env.PASSWORD || ''
      );
    }
  } else {
    if (authInfo.signature && authInfo.username) {
      isAuthorized = await verifyAuthSession(
        authInfo,
        authInfo.username,
        process.env.PASSWORD || ''
      );
    }
  }

  if (!isAuthorized) {
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
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }
  const ua = liveSource.ua || 'AptvPlayer/1.4.10';

  let response: Response | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    response = await fetchSafeRemoteUrl(url, {
      headers: {
        'User-Agent': ua,
      },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch segment' },
        { status: 500 }
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', 'video/mp2t');
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, Range, Origin, Accept'
    );
    headers.set('Accept-Ranges', 'bytes');
    headers.set(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range'
    );
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }

    // 使用流式傳輸，避免佔用內存
    let isCancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        if (!response?.body) {
          controller.close();
          return;
        }

        reader = response.body.getReader();

        function pump() {
          if (isCancelled || !reader) {
            return;
          }

          reader
            .read()
            .then(({ done, value }) => {
              if (isCancelled) {
                return;
              }

              if (done) {
                controller.close();
                cleanup();
                return;
              }

              controller.enqueue(value);
              pump();
            })
            .catch((error) => {
              if (!isCancelled) {
                controller.error(error);
                cleanup();
              }
            });
        }

        function cleanup() {
          if (reader) {
            try {
              reader.releaseLock();
            } catch (e) {
              // reader 可能已經被釋放，忽略錯誤
            }
            reader = null;
          }
        }

        pump();
      },
      cancel() {
        // 當流被取消時，確保釋放所有資源
        isCancelled = true;
        if (reader) {
          try {
            reader.releaseLock();
          } catch (e) {
            // reader 可能已經被釋放，忽略錯誤
          }
          reader = null;
        }

        if (response?.body) {
          try {
            response.body.cancel();
          } catch (e) {
            // 忽略取消時的錯誤
          }
        }
      },
    });

    return new Response(stream, { headers });
  } catch (error) {
    // 確保在錯誤情況下也釋放資源
    if (reader) {
      try {
        (reader as ReadableStreamDefaultReader<Uint8Array>).releaseLock();
      } catch (e) {
        // 忽略錯誤
      }
    }

    if (response?.body) {
      try {
        response.body.cancel();
      } catch (e) {
        // 忽略錯誤
      }
    }

    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch segment' },
      { status: 500 }
    );
  }
}
