export function buildLiveLogoProxyUrl(
  logoUrl?: string,
  sourceKey?: string
): string {
  if (!logoUrl) return '';
  const params = new URLSearchParams({
    url: logoUrl,
    'moontv-source': sourceKey || '',
  });
  return `/api/proxy/logo?${params.toString()}`;
}
