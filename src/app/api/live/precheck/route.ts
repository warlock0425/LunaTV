/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import {
  isValidApiRemoteUrl,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { getConfig } from '@/lib/config';
import {
  fetchSafeRemoteUrl,
  readResponseTextWithLimit,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const PRECHECK_TIMEOUT_MS = 10000;
const MAX_PRECHECK_MANIFEST_BYTES = 512 * 1024;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('moontv-source');

  if (!url || !isValidApiRemoteUrl(url)) {
    return NextResponse.json(
      { error: 'Missing or invalid url' },
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
  const liveSource = config.LiveConfig?.find(
    (s: any) => s.key === source && !s.disabled
  );
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
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
