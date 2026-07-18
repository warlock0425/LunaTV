import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { resetConfig } from '@/lib/config';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地儲存進行管理員配置',
      },
      { status: 400 }
    );
  }

  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  if (username !== process.env.USERNAME) {
    return NextResponse.json({ error: '僅支持站長重置配置' }, { status: 401 });
  }

  try {
    await resetConfig();

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理員配置不緩存
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '重置管理员配置失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
