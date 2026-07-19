import { NextRequest, NextResponse } from 'next/server';

import {
  isValidApiMediaId,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { getCachedLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
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
