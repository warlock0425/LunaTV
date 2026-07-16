/* eslint-disable no-console,@typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getAuthSignaturePayload } from '@/lib/auth';
import { getFreshConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  clearLoginAttempts,
  consumeLoginAttempt,
  getSessionVersion,
} from '@/lib/security-store';

export const runtime = 'nodejs';

// 登入限制會優先使用已設定的 Redis / Kvrocks / Upstash，否則退回單機記憶體。
const LOGIN_RATE_LIMIT_MAX = 5; // 失敗次數上限
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 鎖定 15 分鐘

// 讀取儲存類型環境變量，預設 localstorage
const STORAGE_TYPE =
  ((process.env.STORAGE_TYPE || process.env.NEXT_PUBLIC_STORAGE_TYPE) as
    'localstorage' | 'redis' | 'upstash' | 'kvrocks' | undefined) ||
  'localstorage';

// 生成簽名
async function generateSignature(
  data: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  // 匯入密鑰
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // 生成簽名
  const signature = await crypto.subtle.sign('HMAC', key, messageData);

  // 轉換為十六進製字符串
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 生成認證Cookie（帶簽名）
async function generateAuthCookie(
  username?: string,
  password?: string,
  role?: 'owner' | 'admin' | 'user',
  includePassword = false
): Promise<string> {
  const authData: any = { role: role || 'user' };

  // 只在需要時包含 password
  if (includePassword && password) {
    authData.password = password;
  }

  if (username && process.env.PASSWORD) {
    authData.username = username;
    authData.sessionVersion = await getSessionVersion(username);
    const timestamp = Date.now();
    const signature = await generateSignature(
      getAuthSignaturePayload(username, timestamp, authData.sessionVersion),
      process.env.PASSWORD
    );
    authData.signature = signature;
    authData.timestamp = timestamp;
  }

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(req: NextRequest) {
  try {
    // 速率限制檢查
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown';
    const isE2ETest = process.env.PASSWORD === 'e2e-test-password';
    if (!isE2ETest) {
      const distributedLimit = await consumeLoginAttempt(
        clientIp,
        LOGIN_RATE_LIMIT_MAX,
        LOGIN_RATE_LIMIT_WINDOW_MS / 1000
      );
      if (distributedLimit.blocked) {
        return NextResponse.json(
          { ok: false, error: '登入嘗試過多，請稍後再試' },
          {
            status: 429,
            headers: { 'Retry-After': String(distributedLimit.retryAfter) },
          }
        );
      }
    }
    // 本地 / localStorage 模式——僅校驗固定密碼
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;
      const isProd = process.env.NODE_ENV === 'production';

      // 未配置 PASSWORD 時直接放行
      if (!envPassword) {
        const response = NextResponse.json({ ok: true });

        // 清除可能存在的認證cookie
        response.cookies.set('auth', '', {
          path: '/',
          expires: new Date(0),
          sameSite: 'lax', // 改為 lax 以支持 PWA
          httpOnly: true,
          secure: isProd && !process.env.CI,
        });
        response.cookies.set('user_info', '', {
          path: '/',
          expires: new Date(0),
          sameSite: 'lax',
          httpOnly: false,
          secure: isProd && !process.env.CI,
        });

        return response;
      }

      const { password } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
      }

      if (password !== envPassword) {
        return NextResponse.json(
          { ok: false, error: '密碼錯誤' },
          { status: 401 }
        );
      }

      // 驗證成功，設定認證cookie (使用 hmac 簽名 'localstorage'，避免儲存明文密碼)
      await clearLoginAttempts(clientIp);
      const response = NextResponse.json({ ok: true });
      const timestamp = Date.now();
      const sessionVersion = await getSessionVersion('localstorage');
      const signature = await generateSignature(
        getAuthSignaturePayload('localstorage', timestamp, sessionVersion),
        password
      );
      const authCookieValue = encodeURIComponent(
        JSON.stringify({
          role: 'user',
          username: 'localstorage',
          signature,
          timestamp,
          sessionVersion,
        })
      );
      const userInfoCookieValue = encodeURIComponent(
        JSON.stringify({
          role: 'user',
          username: 'localstorage',
        })
      );

      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天過期

      response.cookies.set('auth', authCookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: true,
        secure: isProd && !process.env.CI,
      });
      response.cookies.set('user_info', userInfoCookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false,
        secure: isProd,
      });

      await clearLoginAttempts(clientIp);
      return response;
    }

    // 資料庫 / redis 模式——校驗使用者名並嘗試連接資料庫
    const { username, password } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '使用者名不能為空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
    }

    // 可能是站長，直接讀環境變量
    if (
      username === process.env.USERNAME &&
      password === process.env.PASSWORD
    ) {
      // 驗證成功，設定認證cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(
        username,
        password,
        'owner',
        false
      ); // 資料庫模式不包含 password
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天過期
      const isProd = process.env.NODE_ENV === 'production';

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax', // 改為 lax 以支持 PWA
        httpOnly: true,
        secure: isProd && !process.env.CI,
      });

      const userInfoCookieValue = encodeURIComponent(
        JSON.stringify({
          role: 'owner',
          username,
        })
      );
      response.cookies.set('user_info', userInfoCookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false,
        secure: isProd && !process.env.CI,
      });

      await clearLoginAttempts(clientIp);
      return response;
    } else if (username === process.env.USERNAME) {
      return NextResponse.json(
        { error: '使用者名或密碼錯誤' },
        { status: 401 }
      );
    }

    const config = await getFreshConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (user && user.banned) {
      return NextResponse.json({ error: '使用者被封禁' }, { status: 401 });
    }

    // 校驗使用者密碼
    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        return NextResponse.json(
          { error: '使用者名或密碼錯誤' },
          { status: 401 }
        );
      }

      // 驗證成功，設定認證cookie
      const response = NextResponse.json({ ok: true });
      const cookieValue = await generateAuthCookie(
        username,
        password,
        user?.role || 'user',
        false
      ); // 資料庫模式不包含 password
      const expires = new Date();
      expires.setDate(expires.getDate() + 7); // 7天過期
      const isProd = process.env.NODE_ENV === 'production';

      response.cookies.set('auth', cookieValue, {
        path: '/',
        expires,
        sameSite: 'lax', // 改為 lax 以支持 PWA
        httpOnly: true,
        secure: isProd && !process.env.CI,
      });

      const userInfoCookieValue = encodeURIComponent(
        JSON.stringify({
          role: user?.role || 'user',
          username,
        })
      );
      response.cookies.set('user_info', userInfoCookieValue, {
        path: '/',
        expires,
        sameSite: 'lax',
        httpOnly: false,
        secure: isProd && !process.env.CI,
      });

      await clearLoginAttempts(clientIp);
      return response;
    } catch (err) {
      console.error('資料庫驗證失敗', err);
      return NextResponse.json({ error: '資料庫錯誤' }, { status: 500 });
    }
  } catch (error) {
    console.error('登入接口異常', error);
    return NextResponse.json({ error: '伺服器錯誤' }, { status: 500 });
  }
}
