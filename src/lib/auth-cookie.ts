export type CookieRequestLike = {
  headers: { get(name: string): string | null };
  nextUrl?: { protocol: string };
  url?: string;
};

type EnvLike = {
  COOKIE_SECURE?: string;
  SITE_BASE?: string;
  [key: string]: string | undefined;
};

function parseBooleanEnv(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return null;
}

function forwardedProto(request: CookieRequestLike): 'http' | 'https' | null {
  const forwarded = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwarded === 'https' || forwarded === 'http') return forwarded;
  return null;
}

function requestProtocol(request: CookieRequestLike): 'http' | 'https' | null {
  const protocol =
    request.nextUrl?.protocol ||
    (request.url ? new URL(request.url).protocol : '');
  if (protocol === 'https:') return 'https';
  if (protocol === 'http:') return 'http';
  return null;
}

function requestHost(request: CookieRequestLike): string {
  const forwarded = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim();
  if (forwarded) return forwarded.toLowerCase();
  const host = request.headers.get('host');
  if (host) return host.toLowerCase();
  if (request.url) {
    try {
      return new URL(request.url).host.toLowerCase();
    } catch {
      return '';
    }
  }
  return '';
}

function siteBaseIsHttpsForRequest(
  siteBase: string | undefined,
  request?: CookieRequestLike
): boolean {
  const value = siteBase?.trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return false;
    if (!request) return true;
    const incomingHost = requestHost(request);
    return incomingHost !== '' && incomingHost === parsed.host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * 登入 cookie 是否加 Secure。
 *
 * 不用 NODE_ENV===production 一刀切：Docker 正式映像也常被用
 * http://192.168.x.x:3000 開啟，Secure cookie 會被瀏覽器丟掉。
 *
 * 優先序：COOKIE_SECURE → x-forwarded-proto → 請求 URL 協定 →
 * SITE_BASE（僅當請求 host 與公開站台一致，避免 LAN IP 被 https 站址帶壞）。
 */
export function shouldUseSecureCookies(
  request?: CookieRequestLike,
  env: EnvLike = process.env
): boolean {
  const explicit = parseBooleanEnv(env.COOKIE_SECURE);
  if (explicit !== null) return explicit;

  if (request) {
    const forwarded = forwardedProto(request);
    if (forwarded) return forwarded === 'https';
    if (requestProtocol(request) === 'https') return true;
  }

  return siteBaseIsHttpsForRequest(env.SITE_BASE, request);
}

export function getAuthCookieOptions(
  request?: CookieRequestLike,
  expires?: Date
) {
  return {
    path: '/',
    ...(expires ? { expires } : {}),
    sameSite: 'lax' as const,
    httpOnly: true,
    secure: shouldUseSecureCookies(request),
  };
}

export function getUserInfoCookieOptions(
  request?: CookieRequestLike,
  expires?: Date
) {
  return {
    ...getAuthCookieOptions(request, expires),
    httpOnly: false,
  };
}
