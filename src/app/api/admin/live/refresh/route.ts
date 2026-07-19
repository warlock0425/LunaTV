/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { refreshLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // 權限檢查
    const authInfo = getAuthInfoFromCookie(request);
    const username = authInfo?.username;
    const config = await getConfig();
    if (username !== process.env.USERNAME) {
      // 管理員
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    // 並發重新整理所有啟用的直播源
    const refreshPromises = (config.LiveConfig || [])
      .filter((liveInfo) => !liveInfo.disabled)
      .map(async (liveInfo) => {
        try {
          const nums = await refreshLiveChannels(liveInfo);
          liveInfo.channelNumber = nums;
        } catch (error) {
          liveInfo.channelNumber = 0;
        }
      });

    // 等待所有重新整理任務完成
    await Promise.all(refreshPromises);

    // 儲存設定
    await db.saveAdminConfig(config);
    setCachedConfig(config);

    return NextResponse.json({
      success: true,
      message: '直播源重新整理成功',
    });
  } catch (error) {
    console.error('直播源重新整理失敗:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '重新整理失敗' },
      { status: 500 }
    );
  }
}
