import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { readJsonObject } from '@/lib/api-input-validation';
import {
  getAuthCookieOptions,
  getUserInfoCookieOptions,
} from '@/lib/auth-cookie';
import { db } from '@/lib/db';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import {
  clearLoginAttempts,
  consumeLoginAttempt,
  revokeUserSessions,
} from '@/lib/security-store';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

/** 與登入相同：5 次失敗、鎖定 15 分鐘 */
const CHANGE_PASSWORD_MAX_ATTEMPTS = 5;
const CHANGE_PASSWORD_WINDOW_SECONDS = 15 * 60;

function changePasswordIdentity(username: string): string {
  return `changepw:user:${username}`;
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const storageType = getServerStorageType();

  // 不支援 localstorage 模式
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支援本地存儲模式修改密碼',
      },
      { status: 400 }
    );
  }

  try {
    const body = await readJsonObject<{
      currentPassword?: unknown;
      newPassword?: unknown;
    }>(request);
    if (!body) {
      return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
    }
    const { currentPassword, newPassword } = body;

    // 取得認證資訊
    const activeUser = await requireActiveUser(request);
    if (!activeUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = activeUser.username;

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

    // 站長密碼只存在部署環境變數，線上改密不會生效
    if (username === process.env.USERNAME) {
      return NextResponse.json(
        {
          error: '站長密碼由部署環境變數 PASSWORD 控制，無法於線上修改',
        },
        { status: 400 }
      );
    }

    const identity = changePasswordIdentity(username);
    const attempt = await consumeLoginAttempt(
      identity,
      CHANGE_PASSWORD_MAX_ATTEMPTS,
      CHANGE_PASSWORD_WINDOW_SECONDS
    );
    if (attempt.blocked) {
      return NextResponse.json(
        { error: '嘗試次數過多，請稍後再試' },
        {
          status: 429,
          headers: { 'Retry-After': String(attempt.retryAfter) },
        }
      );
    }

    const passwordMatches = await db.verifyUser(username, currentPassword);
    if (!passwordMatches) {
      return NextResponse.json({ error: '目前密碼錯誤' }, { status: 401 });
    }

    await clearLoginAttempts(identity);
    await db.changePassword(username, newPassword);
    await revokeUserSessions(username);

    const response = NextResponse.json({ ok: true, reloginRequired: true });
    const expired = new Date(0);
    response.cookies.set('auth', '', getAuthCookieOptions(request, expired));
    response.cookies.set(
      'user_info',
      '',
      getUserInfoCookieOptions(request, expired)
    );
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
