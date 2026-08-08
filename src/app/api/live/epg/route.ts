import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import {
  isValidApiMediaId,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { getCachedLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';
const LIVE_EPG_RATE_LIMIT = 90;
const LIVE_EPG_RATE_WINDOW_SECONDS = 60;

export async function GET(request: NextRequest) {
  // 第二道驗證：與 /api/proxy/* 一致，不依賴 proxy 作為唯一防線
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limited = await enforceRateLimit(request, {
    namespace: 'api-live-epg',
    limit: LIVE_EPG_RATE_LIMIT,
    windowSeconds: LIVE_EPG_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');
    const tvgId = searchParams.get('tvgId');

    if (!sourceKey || !isValidApiSource(sourceKey)) {
      return NextResponse.json(
        { error: '缺少或無效的直播源參數' },
        { status: 400 }
      );
    }

    if (!tvgId || !isValidApiMediaId(tvgId)) {
      return NextResponse.json(
        { error: '缺少或無效的頻道tvg-id參數' },
        { status: 400 }
      );
    }

    const channelData = await getCachedLiveChannels(sourceKey);

    if (!channelData) {
      return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
    }

    // 從epgs字段中取得對應tvgId的節目單資訊
    const epgData = channelData.epgs[tvgId] || [];

    return NextResponse.json({
      success: true,
      data: {
        tvgId,
        source: sourceKey,
        epgUrl: channelData.epgUrl,
        programs: epgData,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: '取得節目單資訊失敗' }, { status: 500 });
  }
}
