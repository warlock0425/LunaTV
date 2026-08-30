import { NextResponse } from 'next/server';

import { logger } from '@/lib/logger';
import { authorizeProxyFetch } from '@/lib/proxy-access';
import {
  fetchSafeRemoteUrl,
  readResponseBytesWithLimit,
  UnsafeRemoteUrlError,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const KEY_FETCH_TIMEOUT_MS = 10000;
const MAX_KEY_BYTES = 1024 * 1024;

export async function GET(request: Request) {
  const access = await authorizeProxyFetch(request, 'key');
  if (!access.ok) return access.response;

  const { url, fetchHeaders } = access;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), KEY_FETCH_TIMEOUT_MS);

  try {
    logger.debug('Proxy key request:', url);
    const response = await fetchSafeRemoteUrl(url, {
      headers: fetchHeaders,
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
