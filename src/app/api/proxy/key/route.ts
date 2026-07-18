/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import {
  isValidApiRemoteUrl,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { getAuthInfoFromCookie, verifyAuthSession } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { getServerStorageType } from '@/lib/storage-runtime';
import {
  fetchSafeRemoteUrl,
  isSafeRemoteUrl,
  readResponseBytesWithLimit,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const KEY_FETCH_TIMEOUT_MS = 10000;
const MAX_KEY_BYTES = 1024 * 1024;

export async function GET(request: Request) {
  // 1. 身份與權限驗證
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const storageType = getServerStorageType();
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

  if (source && !isValidApiSource(source)) {
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
  const ua = liveSource.ua || 'AptvPlayer/1.4.10';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KEY_FETCH_TIMEOUT_MS);

  try {
    logger.debug('Proxy key request:', url);
    const response = await fetchSafeRemoteUrl(url, {
      headers: {
        'User-Agent': ua,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      void response.body?.cancel();
      return NextResponse.json(
        { error: 'Failed to fetch key' },
        { status: 500 }
      );
    }
    const keyData = await readResponseBytesWithLimit(response, MAX_KEY_BYTES);
    return new Response(keyData, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch key' },
      { status: controller.signal.aborted ? 504 : 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
