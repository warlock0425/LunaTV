import {
  buildVodHlsProxyUrl,
  isVodHlsProxyUrl,
  shouldFallbackToVodProxy,
} from './vod-hls-proxy';

describe('vod hls proxy url', () => {
  it('builds an authenticated same-origin proxy URL', () => {
    const url = buildVodHlsProxyUrl(
      'https://cdn.example/ep1.m3u8?token=1',
      'guangsu'
    );
    expect(url.startsWith('/api/proxy/m3u8?')).toBe(true);
    const parsed = new URL(url, 'http://lunatv.invalid');
    expect(parsed.searchParams.get('url')).toBe(
      'https://cdn.example/ep1.m3u8?token=1'
    );
    expect(parsed.searchParams.get('moontv-source')).toBe('guangsu');
    expect(parsed.searchParams.get('kind')).toBe('vod');
    expect(isVodHlsProxyUrl(url)).toBe(true);
  });

  it('does not treat live proxy URLs as VOD fallback', () => {
    expect(
      isVodHlsProxyUrl(
        '/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Flive.m3u8&moontv-source=iptv'
      )
    ).toBe(false);
    expect(isVodHlsProxyUrl('https://cdn.example/ep1.m3u8')).toBe(false);
  });

  it('only falls back once, and only on network errors', () => {
    expect(shouldFallbackToVodProxy('networkError', false)).toBe(true);
    expect(shouldFallbackToVodProxy('networkError', true)).toBe(false);
    expect(shouldFallbackToVodProxy('mediaError', false)).toBe(false);
  });
});
