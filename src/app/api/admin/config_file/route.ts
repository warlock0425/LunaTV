import { NextRequest, NextResponse } from 'next/server';

import { requireOwner } from '@/lib/api-auth';
import { readJsonObject } from '@/lib/api-input-validation';
import {
  getFreshConfig,
  parseConfigFile,
  refineConfig,
  setCachedConfig,
} from '@/lib/config';
import { db } from '@/lib/db';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支援本地存儲進行管理員設定',
      },
      { status: 400 }
    );
  }

  const owner = await requireOwner(request);
  if (!owner) {
    return NextResponse.json(
      { error: '權限不足，只有站長可以修改設定檔' },
      { status: 401 }
    );
  }

  try {
    // 取得請求體
    const body = await readJsonObject(request);
    if (!body) {
      return NextResponse.json(
        { error: '請提供有效的 JSON 物件' },
        { status: 400 }
      );
    }
    const { configFile, subscriptionUrl, autoUpdate, lastCheckTime } = body;

    if (!configFile || typeof configFile !== 'string') {
      return NextResponse.json(
        { error: '設定檔內容不能為空' },
        { status: 400 }
      );
    }

    // 驗證 JSON 與執行時結構，避免把錯誤型別寫進共享設定。
    try {
      parseConfigFile(configFile);
    } catch (e) {
      return NextResponse.json(
        {
          error: '設定檔格式錯誤',
          details: e instanceof Error ? e.message : undefined,
        },
        { status: 400 }
      );
    }

    if (subscriptionUrl !== undefined && typeof subscriptionUrl !== 'string') {
      return NextResponse.json({ error: '訂閱網址格式錯誤' }, { status: 400 });
    }
    if (autoUpdate !== undefined && typeof autoUpdate !== 'boolean') {
      return NextResponse.json({ error: '自動更新格式錯誤' }, { status: 400 });
    }
    if (lastCheckTime !== undefined && typeof lastCheckTime !== 'string') {
      return NextResponse.json({ error: '檢查時間格式錯誤' }, { status: 400 });
    }

    // 讀→改→寫整段在鎖內；鎖後必須 getFreshConfig 重讀，避免 lost update
    await db.withAdminConfigLock(async () => {
      const current = await getFreshConfig();
      const nextConfig = structuredClone(current);
      nextConfig.ConfigFile = configFile;
      if (!nextConfig.ConfigSubscription) {
        nextConfig.ConfigSubscription = {
          URL: '',
          AutoUpdate: false,
          LastCheck: '',
        };
      }

      if (subscriptionUrl !== undefined) {
        nextConfig.ConfigSubscription.URL = subscriptionUrl;
      }
      if (autoUpdate !== undefined) {
        nextConfig.ConfigSubscription.AutoUpdate = autoUpdate;
      }
      nextConfig.ConfigSubscription.LastCheck = lastCheckTime || '';

      const adminConfig = refineConfig(nextConfig);
      await db.saveAdminConfig(adminConfig);
      setCachedConfig(adminConfig);
    });
    return NextResponse.json({
      success: true,
      message: '設定檔更新成功',
    });
  } catch (error) {
    console.error('更新設定檔失敗:', error);
    return NextResponse.json(
      {
        error: '更新設定檔失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
