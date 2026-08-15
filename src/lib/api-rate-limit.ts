import { NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from './auth';
import { consumeRateLimit } from './security-store';
import { getServerStorageType } from './storage-runtime';

function parseBooleanEnv(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/** 直連 Docker 時客戶端可偽造 XFF；只有 TRUST_PROXY 開啟才採信。 */
export function isTrustedProxy(
  env: { TRUST_PROXY?: string; [key: string]: string | undefined } = process.env
): boolean {
  return parseBooleanEnv(env.TRUST_PROXY);
}

/**
 * 從請求標頭推導客戶端 IP。
 *
 * 未設 TRUST_PROXY 時不讀 x-forwarded-for / x-real-ip（直連埠對映可偽造）。
 * 截斷長度是因為標頭完全由客戶端控制，未經處理就當 Redis key 會讓攻擊者
 * 灌爆 key 空間。
 */
export function getClientIp(
  request: Request,
  env: { TRUST_PROXY?: string; [key: string]: string | undefined } = process.env
): string {
  if (!isTrustedProxy(env)) return 'unknown';

  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  ).slice(0, 128);
}

export interface RateLimitOptions {
  /** Redis key 前綴，不同用途請用不同 namespace，避免共用同一個計數器 */
  namespace: string;
  /** 時間窗內允許的請求數上限 */
  limit: number;
  /** 時間窗長度（秒） */
  windowSeconds: number;
}

/**
 * 決定限流的計數身分。
 *
 * 規則只有一條：**只有被簽章覆蓋的 username 才能當身分。**
 *
 * cookie 內容全部由客戶端控制，簽章保護的是 getAuthSignaturePayload 的三個值
 * ——`subject`、`timestamp`、`sessionVersion`（見 auth.ts）。注意被簽的是
 * subject，不是 cookie 裡的 `username` 欄位；兩者是不是同一個值要看儲存模式：
 *
 * - 多使用者模式（redis / kvrocks / upstash）：subject 就是 authInfo.username
 *   （proxy.ts、api-auth.ts 皆然）。改動 username 會讓簽章驗不過，請求在
 *   proxy 第一層就被擋掉，所以這個值可以信任。
 * - localstorage 模式：subject 固定是字面值 'localstorage'，`username` 欄位
 *   完全不在簽章範圍內。使用者可以把它改成任意值而簽章照樣通過——若拿它當
 *   計數 key，輪換 username 就能無限重置額度，限流形同虛設。
 *
 * 因此 localstorage 模式一律退回 IP。該模式只有一個主體（唯一的 PASSWORD），
 * username 本來就沒有區辨力；退回 IP 除了安全，多裝置的誤傷也比現在全部擠在
 * 同一個 'user:localstorage' 桶更少。
 *
 * 之後若要在限流裡讀 cookie 的其他欄位，先回來確認那個欄位在你的目標模式下
 * 是否真的被簽章覆蓋。
 */
export function getRateLimitIdentity(request: Request): string {
  const ipIdentity = () => `ip:${getClientIp(request)}`;

  if (getServerStorageType() === 'localstorage') return ipIdentity();

  // 與 IP 一樣要截斷：長度同樣由客戶端決定，未經處理就當 key 會灌爆 key 空間
  const username = getAuthInfoFromCookie(request)?.username?.slice(0, 128);
  return username ? `user:${username}` : ipIdentity();
}

/**
 * 對外抓取端點的共用限流。
 *
 * 計數身分見 getRateLimitIdentity。用使用者名稱（在可信任的模式下）才不會讓
 * 同一個 NAT 後面的多個使用者互相拖累，IP 則是不可信任或未登入時的後備。
 *
 * @returns 超限時回傳 429 response；未超限回傳 null。
 */
export async function enforceRateLimit(
  request: Request,
  { namespace, limit, windowSeconds }: RateLimitOptions
): Promise<NextResponse | null> {
  const identity = getRateLimitIdentity(request);

  const { blocked, retryAfter } = await consumeRateLimit(
    namespace,
    identity,
    limit,
    windowSeconds
  );
  if (!blocked) return null;

  return NextResponse.json(
    { error: '請求過於頻繁，請稍後再試' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'Cache-Control': 'no-store',
      },
    }
  );
}
