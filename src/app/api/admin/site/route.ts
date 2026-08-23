import { revalidatePath } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { readJsonObject } from '@/lib/api-input-validation';
import { getFreshConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

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
    if (!(await requireAdmin(request))) {
      return NextResponse.json({ error: '權限不足' }, { status: 401 });
    }

    const body = await readJsonObject(request);
    if (!body) {
      return NextResponse.json(
        { error: '請提供有效的 JSON 物件' },
        { status: 400 }
      );
    }

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
      PreferValidatedSourceOrder,
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
      PreferValidatedSourceOrder: boolean;
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
      typeof EnableWebLive !== 'boolean' ||
      typeof PreferValidatedSourceOrder !== 'boolean'
    ) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    const response = await db.withAdminConfigLock(async () => {
      const adminConfig = await getFreshConfig();

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
        PreferValidatedSourceOrder: PreferValidatedSourceOrder ?? false,
      };

      await db.saveAdminConfig(adminConfig);
      setCachedConfig(adminConfig);
      return null;
    });
    if (response) return response;

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
