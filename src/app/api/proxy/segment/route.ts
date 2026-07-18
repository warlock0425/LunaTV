/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import {
  isValidApiRemoteUrl,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { getAuthInfoFromCookie, verifyAuthSession } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getServerStorageType } from '@/lib/storage-runtime';
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
  const ua = liveSource.ua || 'AptvPlayer/1.4.10';

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
    });
    if (!response.ok && (response.status < 400 || response.status >= 500)) {
      return NextResponse.json(
        { error: 'Failed to fetch segment' },
        { status: 500 }
      );
    }

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
      const value = response?.headers.get(name);
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
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    if (error instanceof UnsafeRemoteUrlError) {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to fetch segment' },
      { status: 500 }
    );
  } finally {
    if (response && !responseUsed) {
      void response.body?.cancel().catch(() => undefined);
    }
  }
}
