/* eslint-disable no-console */

import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType =
    process.env.STORAGE_TYPE ||
    process.env.NEXT_PUBLIC_STORAGE_TYPE ||
    'localstorage';
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地儲存進行管理員配置',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

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
          'Cache-Control': 'no-store', // 不緩存結果
        },
      }
    );
  } catch (error) {
    console.error('更新站點配置失敗:', error);
    return NextResponse.json(
      {
        error: '更新站點配置失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
