import { NextRequest, NextResponse } from 'next/server';

import { AdminConfigResult } from '@/lib/admin.types';
import { requireAdmin } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支援本地儲存進行管理員設定',
      },
      { status: 400 }
    );
  }

  const admin = await requireAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: '權限不足' }, { status: 401 });
  }

  try {
    const config = await getConfig();
    const result: AdminConfigResult = {
      Role: admin.role,
      Config: config,
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store', // 管理員設定不快取
      },
    });
  } catch (error) {
    console.error('取得管理員設定失敗:', error);
    return NextResponse.json(
      {
        error: '取得管理員設定失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
