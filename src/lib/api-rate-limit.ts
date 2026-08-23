import { NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from './api-auth';
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
 * 規則只有一條：**只有驗過 HMAC 的 username 才能當身分。**
 *
 * cookie 內容全部由客戶端控制。豆瓣／海報代理等豁免端點在 matcher 被繞過時
 * 仍會走到這裡——若只解析 cookie 不驗簽，輪換偽造 username 就能重置額度。
 *
 * - localstorage 模式：subject 固定是字面值 'localstorage'，`username` 欄位
 *   不在簽章範圍內。一律退回 IP。
 * - 多使用者模式：先走 getVerifiedAuthInfo，驗不過就當未登入、改用 IP。
 */
export async function getRateLimitIdentity(request: Request): Promise<string> {
  const ipIdentity = () => `ip:${getClientIp(request)}`;

  if (getServerStorageType() === 'localstorage') return ipIdentity();

  const auth = await getVerifiedAuthInfo(request);
  const username = auth?.username?.slice(0, 128);
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
  const identity = await getRateLimitIdentity(request);

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
