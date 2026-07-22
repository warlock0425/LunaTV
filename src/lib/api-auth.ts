import type { AuthInfo } from './auth';
import {
  getAuthInfoFromCookie,
  getAuthSessionSecret,
  verifyAuthSession,
} from './auth';
import { getConfig } from './config';
import { getServerStorageType } from './storage-runtime';

/**
 * 讀取並「驗證」cookie 中的認證資訊。
 *
 * `getAuthInfoFromCookie` 只是解析 cookie，內容完全由客戶端控制；單獨使用它
 * 等於信任使用者自稱的身分。proxy(middleware) 雖然已驗過簽章，但那是唯一一道
 * 防線——matcher 一改、或 Next.js 再出現 middleware 繞過類問題（如
 * CVE-2025-29927），高權限端點就會直接失守。
 *
 * 這裡對高權限端點補上第二道獨立驗證：只驗 HMAC 簽章與時效，不查
 * sessionVersion（那需要一次 Redis round-trip，留給 middleware 做），
 * 因此不會替管理端點增加 I/O 延遲。
 */
export async function getVerifiedAuthInfo(
  request: Request
): Promise<AuthInfo | null> {
  const authInfo = getAuthInfoFromCookie(request);
  if (!authInfo?.signature) return null;

  const secret = getAuthSessionSecret();
  if (!secret) return null;

  // localstorage 模式登入時是以固定主體 'localstorage' 簽名的（見 api/login），
  // 其餘模式則以使用者名稱為主體。
  const subject =
    getServerStorageType() === 'localstorage'
      ? 'localstorage'
      : authInfo.username;
  if (!subject) return null;

  const verified = await verifyAuthSession(authInfo, subject, secret);
  return verified ? authInfo : null;
}

export interface ActiveUserContext {
  username: string;
  auth: AuthInfo;
}

/**
 * 需要登入的使用者 API 統一入口：
 * 1) HMAC 驗簽（不查 sessionVersion，避免高頻 Redis）
 * 2) 確認使用者存在且未封禁（站長 USERNAME 直接放行）
 * 3) localstorage 模式固定 username = 'localstorage'
 */
export async function requireActiveUser(
  request: Request
): Promise<ActiveUserContext | null> {
  const auth = await getVerifiedAuthInfo(request);
  if (!auth) return null;

  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return { username: 'localstorage', auth };
  }

  if (!auth.username) return null;

  if (auth.username === process.env.USERNAME) {
    return { username: auth.username, auth };
  }

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === auth.username
  );
  if (!user || user.banned) return null;

  return { username: auth.username, auth };
}

export function unauthorizedJson(message = 'Unauthorized', status = 401) {
  return Response.json({ error: message }, { status });
}
