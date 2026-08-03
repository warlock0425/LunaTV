import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import {
  isValidApiMediaId,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { getAvailableApiSites } from '@/lib/config';
import {
  DownstreamNotFoundError,
  DownstreamTimeoutError,
  DownstreamUpstreamError,
  getDetailFromApi,
} from '@/lib/downstream';

export const runtime = 'nodejs';
const DETAIL_RATE_LIMIT = 180;
const DETAIL_RATE_WINDOW_SECONDS = 60;

export async function GET(request: NextRequest) {
  const activeUser = await requireActiveUser(request);
  if (!activeUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limited = await enforceRateLimit(request, {
    namespace: 'api-detail',
    limit: DETAIL_RATE_LIMIT,
    windowSeconds: DETAIL_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  const username = activeUser.username;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
  }

  if (!isValidApiSource(sourceCode) || !isValidApiMediaId(id)) {
    return NextResponse.json({ error: '無效的影片 ID 格式' }, { status: 400 });
  }

  try {
    const apiSites = await getAvailableApiSites(username);
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json({ error: '無效的API來源' }, { status: 400 });
    }

    const result = await getDetailFromApi(apiSite, id);

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof DownstreamNotFoundError) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }
    if (error instanceof DownstreamTimeoutError) {
      return NextResponse.json(
        { error: 'Upstream request timed out' },
        { status: 504 }
      );
    }
    if (error instanceof DownstreamUpstreamError) {
      return NextResponse.json(
        { error: 'Upstream request failed' },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
