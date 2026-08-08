import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { readJsonObject } from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import {
  fetchSafeRemoteUrl,
  parseSafeRemoteUrl,
  readResponseTextWithLimit,
} from '@/lib/url-safety';

export const runtime = 'nodejs';
const CONFIG_FETCH_TIMEOUT_MS = 10_000;
const CONFIG_FETCH_MAX_BYTES = 5 * 1024 * 1024;
/** 站長手動抓訂閱；留餘裕重試 */
const CONFIG_SUBSCRIPTION_FETCH_RATE_LIMIT = 30;
const CONFIG_SUBSCRIPTION_FETCH_RATE_WINDOW_SECONDS = 60;

export async function POST(request: NextRequest) {
  try {
    // 權限檢查：僅站長可以取得設定訂閱
    const authInfo = await getVerifiedAuthInfo(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '權限不足，只有站長可以取得設定訂閱' },
        { status: 401 }
      );
    }

    const limited = await enforceRateLimit(request, {
      namespace: 'api-admin-config-subscription-fetch',
      limit: CONFIG_SUBSCRIPTION_FETCH_RATE_LIMIT,
      windowSeconds: CONFIG_SUBSCRIPTION_FETCH_RATE_WINDOW_SECONDS,
    });
    if (limited) return limited;

    const body = await readJsonObject(request);
    if (!body) {
      return NextResponse.json(
        { error: '請提供有效的 JSON 物件' },
        { status: 400 }
      );
    }
    const { url } = body;

    if (typeof url !== 'string' || !url.trim()) {
      return NextResponse.json({ error: '缺少URL參數' }, { status: 400 });
    }

    const safeUrl = parseSafeRemoteUrl(url);
    if (!safeUrl) {
      return NextResponse.json({ error: '無效的訂閱 URL' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      CONFIG_FETCH_TIMEOUT_MS
    );
    let configContent: string;
    try {
      const response = await fetchSafeRemoteUrl(safeUrl.toString(), {
        signal: controller.signal,
      });
      if (!response.ok) {
        return NextResponse.json(
          { error: `請求失敗: ${response.status} ${response.statusText}` },
          { status: response.status }
        );
      }
      configContent = await readResponseTextWithLimit(
        response,
        CONFIG_FETCH_MAX_BYTES
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // 對 configContent 進行 base58 解碼
    let decodedContent;
    try {
      const bs58 = (await import('bs58')).default;
      const decodedBytes = bs58.decode(configContent.trim());
      decodedContent = new TextDecoder().decode(decodedBytes);
    } catch (decodeError) {
      console.warn('Base58 解碼失敗', decodeError);
      throw decodeError;
    }

    return NextResponse.json({
      success: true,
      configContent: decodedContent,
      message: '設定取得成功',
    });
  } catch (error) {
    console.error('取得設定失敗:', error);
    return NextResponse.json({ error: '取得設定失敗' }, { status: 500 });
  }
}
