import { NextRequest } from 'next/server';

/**
 * Session HMAC 密鑰：優先 SESSION_SECRET，否則回退 PASSWORD（相容舊部署）。
 * 登入密碼校驗仍只用 PASSWORD。
 *
 * 未設 SESSION_SECRET 時只警告一次：多使用者部署應設獨立密鑰，
 * 否則改 PASSWORD 會使所有 session 簽章失效。
 */
let warnedMissingSessionSecret = false;

export function getAuthSessionSecret(): string | null {
  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (sessionSecret) return sessionSecret;
  const password = process.env.PASSWORD?.trim();
  if (password && !warnedMissingSessionSecret) {
    warnedMissingSessionSecret = true;
    console.warn(
      '[auth] SESSION_SECRET 未設定，session 簽章回退 PASSWORD。' +
        '多使用者／正式部署請設定 SESSION_SECRET；' +
        '變更 PASSWORD 會使所有既有 session 失效。'
    );
  }
  return password || null;
}

/** 僅供測試重置「已警告」旗標 */
export function __resetSessionSecretWarningForTests(): void {
  warnedMissingSessionSecret = false;
}

export const AUTH_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AUTH_SESSION_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface AuthInfo {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
  sessionVersion?: number;
}

export function getAuthSignaturePayload(
  subject: string,
  timestamp: number,
  sessionVersion = 1
): string {
  return `${subject}:${timestamp}:${sessionVersion}`;
}

// 驗證簽名 (公用 HMAC-SHA-256)
export async function verifySignature(
  data: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  try {
    // 匯入金鑰
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 將十六進位字串轉換為 Uint8Array
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
    );

    // 驗證簽名
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData
    );
  } catch (error) {
    console.error('簽名驗證失敗:', error);
    return false;
  }
}

export async function verifyAuthSession(
  authInfo: AuthInfo,
  subject: string,
  secret: string,
  now = Date.now()
): Promise<boolean> {
  if (
    !authInfo.signature ||
    !Number.isInteger(authInfo.timestamp) ||
    !authInfo.timestamp
  ) {
    return false;
  }

  const age = now - authInfo.timestamp;
  if (age < -AUTH_SESSION_CLOCK_SKEW_MS || age > AUTH_SESSION_MAX_AGE_MS) {
    return false;
  }

  return verifySignature(
    getAuthSignaturePayload(
      subject,
      authInfo.timestamp,
      authInfo.sessionVersion || 1
    ),
    authInfo.signature,
    secret
  );
}

// 從 cookie 取得認證資訊 (服務端使用，支援 NextRequest 與標準 Request)
export function getAuthInfoFromCookie(
  request: NextRequest | Request
): AuthInfo | null {
  let cookieVal: string | undefined;

  if ('cookies' in request && typeof request.cookies.get === 'function') {
    cookieVal = request.cookies.get('auth')?.value;
  } else {
    // 標準 Request，解析 headers 中的 Cookie
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;)\s*auth=([^;]*)/);
      if (match) {
        cookieVal = match[1];
      }
    }
  }

  if (!cookieVal) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(cookieVal);
    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
  }
}

// 從 cookie 取得認證資訊 (客戶端使用，優先讀取 user_info cookie)
export function getAuthInfoFromBrowserCookie(): AuthInfo | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce(
      (acc, cookie) => {
        const trimmed = cookie.trim();
        const firstEqualIndex = trimmed.indexOf('=');

        if (firstEqualIndex > 0) {
          const key = trimmed.substring(0, firstEqualIndex);
          const value = trimmed.substring(firstEqualIndex + 1);
          if (key && value) {
            acc[key] = value;
          }
        }

        return acc;
      },
      {} as Record<string, string>
    );

    // 優先讀取 user_info，若無（例如舊登入快取）則 fallback 到 auth
    const authCookie = cookies['user_info'] || cookies['auth'];
    if (!authCookie) {
      return null;
    }

    // 處理可能的雙重編碼
    let decoded = decodeURIComponent(authCookie);

    // 如果解碼後仍然包含 %，說明是雙重編碼，需要再次解碼
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }

    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
  }
}
