/* eslint-disable no-console*/

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { revokeUserSessions } from '@/lib/security-store';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const storageType =
    process.env.STORAGE_TYPE ||
    process.env.NEXT_PUBLIC_STORAGE_TYPE ||
    'localstorage';

  // 不支持 localstorage 模式
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支持本地存儲模式修改密碼',
      },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    // 获取认证信息
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 驗證新密碼
    if (!currentPassword || typeof currentPassword !== 'string') {
      return NextResponse.json({ error: '請輸入目前密碼' }, { status: 400 });
    }
    if (
      !newPassword ||
      typeof newPassword !== 'string' ||
      newPassword.length > 128
    ) {
      return NextResponse.json({ error: '新密碼不得為空' }, { status: 400 });
    }

    const username = authInfo.username;

    // 不允许站长修改密码（站长用户名等于 process.env.USERNAME）
    if (username === process.env.USERNAME) {
      return NextResponse.json(
        { error: '站長不能通過此接口修改密碼' },
        { status: 403 }
      );
    }

    const passwordMatches = await db.verifyUser(username, currentPassword);
    if (!passwordMatches) {
      return NextResponse.json({ error: '目前密碼錯誤' }, { status: 401 });
    }

    await db.changePassword(username, newPassword);
    await revokeUserSessions(username);

    const response = NextResponse.json({ ok: true, reloginRequired: true });
    const isProd = process.env.NODE_ENV === 'production';
    response.cookies.set('auth', '', {
      path: '/',
      expires: new Date(0),
      sameSite: 'lax',
      httpOnly: true,
      secure: isProd,
    });
    response.cookies.set('user_info', '', {
      path: '/',
      expires: new Date(0),
      sameSite: 'lax',
      httpOnly: false,
      secure: isProd,
    });
    return response;
  } catch (error) {
    console.error('修改密碼失敗:', error);
    return NextResponse.json(
      {
        error: '修改密碼失敗',
      },
      { status: 500 }
    );
  }
}
