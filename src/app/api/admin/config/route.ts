/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfigResult } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
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

  try {
    const config = await getConfig();
    const result: AdminConfigResult = {
      Role: 'owner',
      Config: config,
    };
    if (username === process.env.USERNAME) {
      result.Role = 'owner';
    } else {
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (user && user.role === 'admin' && !user.banned) {
        result.Role = 'admin';
      } else {
        return NextResponse.json({ error: '無管理員權限' }, { status: 401 });
      }
    }

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store', // 管理員配置不緩存
      },
    });
  } catch (error) {
    console.error('獲取管理員配置失敗:', error);
    return NextResponse.json(
      {
        error: '獲取管理員配置失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
