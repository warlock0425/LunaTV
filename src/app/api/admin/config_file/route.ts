/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { readJsonObject } from '@/lib/api-input-validation';
import { getAuthInfoFromCookie } from '@/lib/auth';
import {
  getConfig,
  parseConfigFile,
  refineConfig,
  setCachedConfig,
} from '@/lib/config';
import { db } from '@/lib/db';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存儲進行管理員配置',
      },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  try {
    // 檢查使用者權限
    let adminConfig = await getConfig();

    // 僅站長可以修改配置文件
    if (username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '權限不足，只有站長可以修改設定檔' },
        { status: 401 }
      );
    }

    // 獲取請求體
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
        { error: '配置文件內容不能為空' },
        { status: 400 }
      );
    }

    // 驗證 JSON 與執行時結構，避免把錯誤型別寫進共享設定。
    try {
      parseConfigFile(configFile);
    } catch (e) {
      return NextResponse.json(
        {
          error: '配置文件格式錯誤',
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

    const nextConfig = structuredClone(adminConfig);
    nextConfig.ConfigFile = configFile;
    if (!nextConfig.ConfigSubscription) {
      nextConfig.ConfigSubscription = {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      };
    }

    // 更新訂閱配置
    if (subscriptionUrl !== undefined) {
      nextConfig.ConfigSubscription.URL = subscriptionUrl;
    }
    if (autoUpdate !== undefined) {
      nextConfig.ConfigSubscription.AutoUpdate = autoUpdate;
    }
    nextConfig.ConfigSubscription.LastCheck = lastCheckTime || '';

    adminConfig = refineConfig(nextConfig);
    // 更新配置文件
    await db.saveAdminConfig(adminConfig);
    setCachedConfig(adminConfig);
    return NextResponse.json({
      success: true,
      message: '配置文件更新成功',
    });
  } catch (error) {
    console.error('更新配置文件失敗:', error);
    return NextResponse.json(
      {
        error: '更新配置文件失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
