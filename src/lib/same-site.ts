function isTrustedProxy(env: {
  TRUST_PROXY?: string;
  [key: string]: string | undefined;
}): boolean {
  const normalized = env.TRUST_PROXY?.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/**
 * Origin 的 host 是否與本站一致。
 *
 * 只比 host、不比 scheme：Cloudflare／反向代理在邊緣終止 TLS 時，
 * 瀏覽器 Origin 是 https://…，容器看到的 Host 卻是 http 內部位址，
 * 比完整 origin 會在正式站誤 403。攻擊頁的 host 一定不同，比 host 足夠。
 *
 * x-forwarded-host 僅在 TRUST_PROXY 時採信，否則客戶端可偽造成「同源」。
 */
export function isSameSiteHost(
  request: Request,
  env: { TRUST_PROXY?: string; [key: string]: string | undefined } = process.env
): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    const expectedHost = resolveExpectedHost(request, env);
    if (!expectedHost) return false;
    return originHost === expectedHost;
  } catch {
    return false;
  }
}

function resolveExpectedHost(
  request: Request,
  env: { TRUST_PROXY?: string; [key: string]: string | undefined }
): string {
  if (isTrustedProxy(env)) {
    const forwarded = request.headers
      .get('x-forwarded-host')
      ?.split(',')[0]
      ?.trim();
    if (forwarded) return forwarded.toLowerCase();
  }

  return (request.headers.get('host') || '').toLowerCase();
}

export function rejectCrossSiteRequest(request: Request): Response | null {
  if (isSameSiteHost(request)) return null;
  return Response.json(
    { error: 'Forbidden' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } }
  );
}
