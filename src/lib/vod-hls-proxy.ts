/** 點播直連失敗後，改走站內 HLS 代理。 */

export function buildVodHlsProxyUrl(
  directUrl: string,
  sourceKey: string
): string {
  const params = new URLSearchParams();
  params.set('url', directUrl);
  params.set('moontv-source', sourceKey);
  params.set('kind', 'vod');
  return `/api/proxy/m3u8?${params.toString()}`;
}

export function isVodHlsProxyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, 'http://lunatv.invalid');
    return (
      parsed.pathname === '/api/proxy/m3u8' &&
      parsed.searchParams.get('kind') === 'vod'
    );
  } catch {
    return false;
  }
}

/** 直連出現無法恢復的網路錯誤時，才降級走代理。 */
export function shouldFallbackToVodProxy(
  errorType: string,
  alreadyProxied: boolean
): boolean {
  return !alreadyProxied && errorType === 'networkError';
}
