/* eslint-disable no-console */

import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { readJsonObject } from '@/lib/api-input-validation';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支援本地儲存進行管理員設定',
      },
      { status: 400 }
    );
  }

  try {
    const body = await readJsonObject(request);
    if (!body) {
      return NextResponse.json(
        { error: '請提供有效的 JSON 物件' },
        { status: 400 }
      );
    }

    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = authInfo.username;

    const {
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      DisableYellowFilter,
      FluidSearch,
      EnableWebLive,
    } = body as {
      SiteName: string;
      Announcement: string;
      SearchDownstreamMaxPage: number;
      SiteInterfaceCacheTime: number;
      DoubanProxyType: string;
      DoubanProxy: string;
      DoubanImageProxyType: string;
      DoubanImageProxy: string;
      DisableYellowFilter: boolean;
      FluidSearch: boolean;
      EnableWebLive: boolean;
    };

    // 參數校驗
    if (
      typeof SiteName !== 'string' ||
      typeof Announcement !== 'string' ||
      typeof SearchDownstreamMaxPage !== 'number' ||
      !Number.isInteger(SearchDownstreamMaxPage) ||
      SearchDownstreamMaxPage < 1 ||
      SearchDownstreamMaxPage > 20 ||
      typeof SiteInterfaceCacheTime !== 'number' ||
      typeof DoubanProxyType !== 'string' ||
      typeof DoubanProxy !== 'string' ||
      typeof DoubanImageProxyType !== 'string' ||
      typeof DoubanImageProxy !== 'string' ||
      typeof DisableYellowFilter !== 'boolean' ||
      typeof FluidSearch !== 'boolean' ||
      typeof EnableWebLive !== 'boolean'
    ) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    const adminConfig = await getConfig();

    // 權限校驗
    if (username !== process.env.USERNAME) {
      // 管理员
      const user = adminConfig.UserConfig.Users.find(
        (u) => u.username === username
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    // 更新快取中的站點設定
    adminConfig.SiteConfig = {
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      DisableYellowFilter,
      FluidSearch,
      EnableWebLive: EnableWebLive ?? false,
    };

    // 寫入資料庫
    await db.saveAdminConfig(adminConfig);
    setCachedConfig(adminConfig);

    revalidatePath('/', 'layout');

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 不快取結果
        },
      }
    );
  } catch (error) {
    console.error('更新站點設定失敗:', error);
    return NextResponse.json(
      {
        error: '更新站點設定失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
