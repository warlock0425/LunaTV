import type { AuthInfo } from './auth';
import { getAuthInfoFromCookie, verifyAuthSession } from './auth';
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

  const secret = process.env.PASSWORD;
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
