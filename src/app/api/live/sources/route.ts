import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { getConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { toSeleneLiveSource } from '@/lib/selene-compat';

export const runtime = 'nodejs';
/** 每次進頁 1 次 */
const LIVE_SOURCES_RATE_LIMIT = 30;
const LIVE_SOURCES_RATE_WINDOW_SECONDS = 60;

export async function GET(request: NextRequest) {
  // 第二道驗證：本端點會回傳完整 LiveConfig（含各直播源的 url 與 epg），
  // 只靠 proxy 這一道防線，matcher 改動或 middleware 繞過類問題就會直接外洩。
  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const limited = await enforceRateLimit(request, {
    namespace: 'api-live-sources',
    limit: LIVE_SOURCES_RATE_LIMIT,
    windowSeconds: LIVE_SOURCES_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  logger.debug('live sources called:', request.url);
  try {
    const config = await getConfig();

    if (!config) {
      return NextResponse.json({ error: '設定未找到' }, { status: 404 });
    }

    // 過濾出所有非 disabled 的直播源。不跟 EnableWebLive 綁在一起：
    // 那支開關只擋網頁直播與 proxy，Selene 要靠這份清單在裝置上直連播放。
    const liveSources = (config.LiveConfig || [])
      .filter((source) => !source.disabled)
      .map(toSeleneLiveSource);

    return NextResponse.json({
      success: true,
      data: liveSources,
    });
  } catch (error) {
    console.error('取得直播源失敗:', error);
    return NextResponse.json({ error: '取得直播源失敗' }, { status: 500 });
  }
}
