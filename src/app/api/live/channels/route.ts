import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { isValidApiSource } from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { getCachedLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';
/** 每次換源 1 次 */
const LIVE_CHANNELS_RATE_LIMIT = 60;
const LIVE_CHANNELS_RATE_WINDOW_SECONDS = 60;

export async function GET(request: NextRequest) {
  // 第二道驗證：與 /api/proxy/* 一致，不依賴 proxy 作為唯一防線
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limited = await enforceRateLimit(request, {
    namespace: 'api-live-channels',
    limit: LIVE_CHANNELS_RATE_LIMIT,
    windowSeconds: LIVE_CHANNELS_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const sourceKey = searchParams.get('source');

    if (!sourceKey || !isValidApiSource(sourceKey)) {
      return NextResponse.json(
        { error: '缺少或無效的直播源參數' },
        { status: 400 }
      );
    }

    const channelData = await getCachedLiveChannels(sourceKey);

    if (!channelData) {
      return NextResponse.json({ error: '頻道資訊未找到' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: channelData.channels,
    });
  } catch (error) {
    return NextResponse.json({ error: '取得頻道資訊失敗' }, { status: 500 });
  }
}
