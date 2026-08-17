import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { getConfig, getFreshConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { refreshLiveChannels } from '@/lib/live';
import { rejectCrossSiteRequest } from '@/lib/same-site';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  try {
    // 權限檢查（可讀快取，不必佔寫鎖）
    const authInfo = await getVerifiedAuthInfo(request);
    const username = authInfo?.username;
    const peek = await getConfig();
    if (username !== process.env.USERNAME) {
      const user = peek.UserConfig.Users.find((u) => u.username === username);
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    // 網路抓取在鎖外；結果以 key→channelNumber 帶回
    const enabled = (peek.LiveConfig || []).filter((live) => !live.disabled);
    const refreshed = await Promise.all(
      enabled.map(async (liveInfo) => {
        try {
          const nums = await refreshLiveChannels(liveInfo);
          return { key: liveInfo.key, nums };
        } catch {
          return null;
        }
      })
    );

    await db.withAdminConfigLock(async () => {
      const config = await getFreshConfig();
      for (const entry of refreshed) {
        if (!entry) continue;
        const live = config.LiveConfig?.find((l) => l.key === entry.key);
        if (live) live.channelNumber = entry.nums;
      }
      await db.saveAdminConfig(config);
      setCachedConfig(config);
    });

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
