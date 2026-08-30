/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server';

import { getClientIp } from '@/lib/api-rate-limit';
import { getAuthSessionSecret, getAuthSignaturePayload } from '@/lib/auth';
import {
  getAuthCookieOptions,
  getUserInfoCookieOptions,
} from '@/lib/auth-cookie';
import { getFreshConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  clearLoginAttempts,
  consumeLoginAttempt,
  getSessionVersion,
} from '@/lib/security-store';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

// 登入限制會優先使用已設定的 Redis / Kvrocks / Upstash，否則退回單機記憶體。
const LOGIN_RATE_LIMIT_MAX = 5; // 失敗次數上限
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 鎖定 15 分鐘

// 讀取儲存類型環境變量，預設 localstorage
const STORAGE_TYPE = getServerStorageType();

async function checkLoginRateLimit(
  identities: string[]
): Promise<NextResponse | null> {
  const results = await Promise.all(
    identities.map((identity) =>
      consumeLoginAttempt(
        identity,
        LOGIN_RATE_LIMIT_MAX,
        LOGIN_RATE_LIMIT_WINDOW_MS / 1000
      )
    )
  );
  const blocked = results.find((result) => result.blocked);
  if (!blocked) return null;

  return NextResponse.json(
    { ok: false, error: '登入嘗試過多，請稍後再試' },
    {
      status: 429,
      headers: { 'Retry-After': String(blocked.retryAfter) },
    }
  );
}

async function clearLoginRateLimits(identities: string[]): Promise<void> {
  await Promise.all(identities.map((identity) => clearLoginAttempts(identity)));
}

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

  const sessionSecret = getAuthSessionSecret();
  if (username && sessionSecret) {
    authData.username = username;
    authData.sessionVersion = await getSessionVersion(username);
    const timestamp = Date.now();
    const signature = await generateSignature(
      getAuthSignaturePayload(username, timestamp, authData.sessionVersion),
      sessionSecret
    );
    authData.signature = signature;
    authData.timestamp = timestamp;
  }

  return encodeURIComponent(JSON.stringify(authData));
}

export async function POST(req: NextRequest) {
  try {
    // 速率限制檢查
    const clientIp = getClientIp(req);
    const isE2ETest = process.env.PASSWORD === 'e2e-test-password';
    // 本地 / localStorage 模式——僅校驗固定密碼
    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      // 未設定 PASSWORD 時直接放行
      if (!envPassword) {
        const response = NextResponse.json({ ok: true });
        const expired = new Date(0);

        response.cookies.set('auth', '', getAuthCookieOptions(req, expired));
        response.cookies.set(
          'user_info',
          '',
          getUserInfoCookieOptions(req, expired)
        );

        return response;
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
      }
      const password =
        typeof body === 'object' && body !== null && 'password' in body
          ? (body as { password?: unknown }).password
          : undefined;
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
      }

      const rateLimitIdentities = [
        ...(clientIp === 'unknown' ? [] : [`login:ip:${clientIp}`]),
        'login:user:localstorage',
      ];
      if (!isE2ETest) {
        const limited = await checkLoginRateLimit(rateLimitIdentities);
        if (limited) return limited;
      }

      if (password !== envPassword) {
        return NextResponse.json(
          { ok: false, error: '密碼錯誤' },
          { status: 401 }
        );
      }

      // 驗證成功，設定認證cookie (使用 hmac 簽名 'localstorage'，避免儲存明文密碼)
      await clearLoginRateLimits(rateLimitIdentities);
      const response = NextResponse.json({ ok: true });
      const timestamp = Date.now();
      const sessionVersion = await getSessionVersion('localstorage');
      const signature = await generateSignature(
        getAuthSignaturePayload('localstorage', timestamp, sessionVersion),
        getAuthSessionSecret() || password
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

      // Selene 只取第一個 Set-Cookie 的 name=value，auth 必須排在 user_info 前面。
      response.cookies.set(
        'auth',
        authCookieValue,
        getAuthCookieOptions(req, expires)
      );
      response.cookies.set(
        'user_info',
        userInfoCookieValue,
        getUserInfoCookieOptions(req, expires)
      );

      return response;
    }

    // 資料庫 / redis 模式——校驗使用者名並嘗試連接資料庫
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
    }
    const username =
      typeof body === 'object' && body !== null && 'username' in body
        ? (body as { username?: unknown }).username
        : undefined;
    const password =
      typeof body === 'object' && body !== null && 'password' in body
        ? (body as { password?: unknown }).password
        : undefined;

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '使用者名不能為空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密碼不能為空' }, { status: 400 });
    }

    const rateLimitIdentities = [
      ...(clientIp === 'unknown' ? [] : [`login:ip:${clientIp}`]),
      `login:user:${username.toLowerCase().slice(0, 128)}`,
    ];
    if (!isE2ETest) {
      const limited = await checkLoginRateLimit(rateLimitIdentities);
      if (limited) return limited;
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

      response.cookies.set(
        'auth',
        cookieValue,
        getAuthCookieOptions(req, expires)
      );

      const userInfoCookieValue = encodeURIComponent(
        JSON.stringify({
          role: 'owner',
          username,
        })
      );
      response.cookies.set(
        'user_info',
        userInfoCookieValue,
        getUserInfoCookieOptions(req, expires)
      );

      await clearLoginRateLimits(rateLimitIdentities);
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

      response.cookies.set(
        'auth',
        cookieValue,
        getAuthCookieOptions(req, expires)
      );

      const userInfoCookieValue = encodeURIComponent(
        JSON.stringify({
          role: user?.role || 'user',
          username,
        })
      );
      response.cookies.set(
        'user_info',
        userInfoCookieValue,
        getUserInfoCookieOptions(req, expires)
      );

      await clearLoginRateLimits(rateLimitIdentities);
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
