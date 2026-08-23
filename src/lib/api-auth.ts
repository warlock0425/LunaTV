import type { AuthInfo } from './auth';
import {
  getAuthInfoFromCookie,
  getAuthSessionSecret,
  verifyAuthSession,
} from './auth';
import { getConfig } from './config';
import { getServerStorageType } from './storage-runtime';

export { isSameSiteHost, rejectCrossSiteRequest } from './same-site';

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
 *
 * ⚠️ 回傳的 AuthInfo 中，**只有簽章 subject 對應的欄位可信**：
 * 多使用者模式的 subject 是 authInfo.username，改它會驗不過，可以信任；
 * localstorage 模式的 subject 是下面那個字面值 'localstorage'，此時
 * `username`（以及 `role` 等其他欄位）都不在簽章範圍內，使用者可以任意
 * 改動而簽章照樣通過。
 *
 * 目前沒有實際危害：權限判斷一律拿 username 去 config.UserConfig.Users
 * 查 DB 再看 role（沒有任何一處信任 cookie 的 role），而 localstorage 模式
 * 只有一個主體。但「localstorage 只會有一個人」是個沒寫在型別裡的假設——
 * 若哪天該模式支援多使用者，讀 authInfo.username 做授權就會變成提權。
 * 需要可信的使用者身分請改用 requireActiveUser（它在該模式下會把 username
 * 硬寫成 'localstorage'）。限流的身分判斷見 api-rate-limit.ts。
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

export type AdminRole = 'owner' | 'admin';

export interface AdminUserContext extends ActiveUserContext {
  role: AdminRole;
}

/**
 * 管理後台營運入口：站長或未被封禁的管理員。
 * localstorage 模式沒有多使用者後台，一律拒絕。
 */
export async function requireAdmin(
  request: Request
): Promise<AdminUserContext | null> {
  const active = await requireActiveUser(request);
  if (!active) return null;
  if (getServerStorageType() === 'localstorage') return null;

  if (active.username === process.env.USERNAME) {
    return { ...active, role: 'owner' };
  }

  const config = await getConfig();
  const user = config.UserConfig.Users.find(
    (entry) => entry.username === active.username
  );
  if (!user || user.banned || user.role !== 'admin') return null;

  return { ...active, role: 'admin' };
}

/**
 * 重型／全庫操作入口：嚴格等於環境變數 USERNAME。
 */
export async function requireOwner(
  request: Request
): Promise<ActiveUserContext | null> {
  const active = await requireActiveUser(request);
  if (!active) return null;
  if (getServerStorageType() === 'localstorage') return null;
  if (active.username !== process.env.USERNAME) return null;
  return active;
}
