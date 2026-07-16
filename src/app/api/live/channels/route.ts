import { NextRequest, NextResponse } from 'next/server';

import { isValidApiSource } from '@/lib/api-input-validation';
import { getCachedLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
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
    return NextResponse.json({ error: '獲取頻道資訊失敗' }, { status: 500 });
  }
}
