import {
  clearLiveProxyRememberedHosts,
  collectLiveSourceRelatedUrls,
  collectStaticLiveProxyHosts,
  getHostnameFromUrl,
  isUrlAllowedForLiveProxy,
  rememberLiveProxyHost,
  vodProxyMemoryKey,
} from './live-proxy-allowlist';

describe('live-proxy-allowlist', () => {
  beforeEach(() => {
    clearLiveProxyRememberedHosts();
  });

  it('getHostnameFromUrl 正規化 host', () => {
    expect(getHostnameFromUrl('https://CDN.Example.com:443/path')).toBe(
      'cdn.example.com'
    );
    expect(getHostnameFromUrl('not-a-url')).toBeNull();
    expect(getHostnameFromUrl('ftp://cdn.example.com/x')).toBeNull();
  });

  it('相關 URL 含 EPG 與頻道台標', () => {
    expect(
      collectLiveSourceRelatedUrls(
        {
          url: 'https://playlist.example/list.m3u',
          epg: 'https://epg.example/tv.xml',
        },
        [
          {
            url: 'https://stream.example/ch.m3u8',
            logo: 'https://logo.example/ch.png',
          },
        ]
      )
    ).toEqual([
      'https://playlist.example/list.m3u',
      'https://epg.example/tv.xml',
      'https://stream.example/ch.m3u8',
      'https://logo.example/ch.png',
    ]);
  });

  it('靜態清單含直播源與頻道 host', () => {
    const hosts = collectStaticLiveProxyHosts(
      'https://playlist.example/list.m3u',
      ['https://stream-a.example/ch1.m3u8', 'https://stream-b.example/ch2.m3u8']
    );
    expect(hosts).toEqual(
      new Set(['playlist.example', 'stream-a.example', 'stream-b.example'])
    );
  });

  it('url 主機不屬於該直播源 → 拒絕（P0 open proxy）', () => {
    expect(
      isUrlAllowedForLiveProxy(
        'live',
        'https://evil.example/huge.iso',
        'https://playlist.example/list.m3u',
        ['https://stream.example/ch.m3u8']
      )
    ).toBe(false);
  });

  it('url 主機與直播源或頻道相同 → 允許', () => {
    expect(
      isUrlAllowedForLiveProxy(
        'live',
        'https://stream.example/seg.ts',
        'https://playlist.example/list.m3u',
        ['https://stream.example/ch.m3u8']
      )
    ).toBe(true);
    expect(
      isUrlAllowedForLiveProxy(
        'live',
        'https://playlist.example/extra.ts',
        'https://playlist.example/list.m3u',
        []
      )
    ).toBe(true);
  });

  it('m3u8 成功後記住的 host 可放行後續 segment', () => {
    expect(
      isUrlAllowedForLiveProxy(
        'live',
        'https://cdn-edge.example/seg.ts',
        'https://playlist.example/list.m3u',
        ['https://stream.example/ch.m3u8']
      )
    ).toBe(false);

    rememberLiveProxyHost('live', 'https://cdn-edge.example/index.m3u8');

    expect(
      isUrlAllowedForLiveProxy(
        'live',
        'https://cdn-edge.example/seg.ts',
        'https://playlist.example/list.m3u',
        ['https://stream.example/ch.m3u8']
      )
    ).toBe(true);
  });

  it('記住的 host 不跨 source key 共用', () => {
    rememberLiveProxyHost('live-a', 'https://cdn-edge.example/index.m3u8');
    expect(
      isUrlAllowedForLiveProxy(
        'live-b',
        'https://cdn-edge.example/seg.ts',
        'https://playlist.example/list.m3u',
        []
      )
    ).toBe(false);
  });

  it('點播記憶體 key 不與直播源共用白名單', () => {
    rememberLiveProxyHost(
      vodProxyMemoryKey('guangsu'),
      'https://vod-cdn.example/index.m3u8'
    );
    expect(
      isUrlAllowedForLiveProxy(
        vodProxyMemoryKey('guangsu'),
        'https://vod-cdn.example/seg.ts',
        '',
        []
      )
    ).toBe(true);
    expect(
      isUrlAllowedForLiveProxy(
        'guangsu',
        'https://vod-cdn.example/seg.ts',
        '',
        []
      )
    ).toBe(false);
  });
});
