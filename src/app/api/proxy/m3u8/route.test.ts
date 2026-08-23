/** @jest-environment node */

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import {
  clearLiveProxyRememberedHosts,
  isUrlAllowedForLiveProxy,
} from '@/lib/live-proxy-allowlist';
import {
  fetchSafeRemoteUrl,
  readResponseTextWithLimit,
} from '@/lib/url-safety';

import { GET } from './route';

jest.mock('@/lib/api-auth', () => ({
  getVerifiedAuthInfo: jest.fn(),
}));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/url-safety', () => ({
  fetchSafeRemoteUrl: jest.fn(),
  isSafeRemoteUrl: jest.fn(() => true),
  readResponseTextWithLimit: jest.fn((response: Response) => response.text()),
  UnsafeRemoteUrlError: class extends Error {},
}));

const mockedGetVerifiedAuth = jest.mocked(getVerifiedAuthInfo);
const mockedGetConfig = jest.mocked(getConfig);
const mockedFetch = jest.mocked(fetchSafeRemoteUrl);
const mockedReadText = jest.mocked(readResponseTextWithLimit);

describe('/api/proxy/m3u8', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearLiveProxyRememberedHosts();
    process.env.STORAGE_TYPE = 'localstorage';
    process.env.PASSWORD = 'secret';
    mockedGetVerifiedAuth.mockResolvedValue({
      username: 'localstorage',
      signature: 'signed',
      timestamp: Date.now(),
    });
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { EnableWebLive: true },
      LiveConfig: [
        {
          key: 'live',
          ua: 'Custom UA',
          url: 'https://cdn.example/playlist.m3u',
          name: 'live',
          from: 'custom',
        },
      ],
    } as Awaited<ReturnType<typeof getConfig>>);
  });

  afterAll(() => {
    delete process.env.STORAGE_TYPE;
    delete process.env.PASSWORD;
  });

  it('rewrites alternate playlists, keys, and low-latency segment URIs', async () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio/index.m3u8"',
      '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=86000,URI="/iframe.m3u8"',
      '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="keys/main.bin"',
      '#EXT-X-PART:DURATION=0.333,URI="parts/1.m4s"',
      '#EXT-X-PRELOAD-HINT:TYPE=PART,URI="parts/2.m4s"',
      '#EXT-X-RENDITION-REPORT:URI="../backup.m3u8",LAST-MSN=10',
    ].join('\n');
    const upstream = new Response(manifest, {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
    });
    Object.defineProperty(upstream, 'url', {
      value: 'https://cdn.example/live/master.m3u8',
    });
    mockedFetch.mockResolvedValue(upstream);

    const request = new Request(
      'https://app.example/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Flive%2Fmaster.m3u8&moontv-source=live',
      { headers: { host: 'app.example', referer: 'https://app.example/live' } }
    );
    const response = await GET(request);
    const content = await response.text();

    expect(mockedFetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(mockedReadText).toHaveBeenCalled();
    expect(content).toContain(
      'URI="https://app.example/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Flive%2Faudio%2Findex.m3u8&moontv-source=live"'
    );
    expect(content).toContain(
      'URI="https://app.example/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Fiframe.m3u8&moontv-source=live"'
    );
    expect(content).toContain(
      'URI="https://app.example/api/proxy/key?url=https%3A%2F%2Fcdn.example%2Flive%2Fkeys%2Fmain.bin&moontv-source=live"'
    );
    expect(content).toContain(
      'URI="https://app.example/api/proxy/segment?url=https%3A%2F%2Fcdn.example%2Flive%2Fparts%2F1.m4s&moontv-source=live"'
    );
    expect(content).toContain(
      'URI="https://app.example/api/proxy/segment?url=https%3A%2F%2Fcdn.example%2Flive%2Fparts%2F2.m4s&moontv-source=live"'
    );
    expect(content).toContain(
      'URI="https://app.example/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Fbackup.m3u8&moontv-source=live"'
    );
  });

  it('rewrites a valid manifest even when the upstream omits Content-Type', async () => {
    const upstream = new Response(
      new TextEncoder().encode('#EXTM3U\n#EXTINF:4,\nsegment.ts')
    );
    Object.defineProperty(upstream, 'url', {
      value: 'https://cdn.example/live/index.m3u8',
    });
    mockedFetch.mockResolvedValue(upstream);

    const response = await GET(
      new Request(
        'https://app.example/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Flive%2Findex.m3u8&moontv-source=live',
        { headers: { host: 'app.example' } }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      'https://app.example/api/proxy/segment?url=https%3A%2F%2Fcdn.example%2Flive%2Fsegment.ts&moontv-source=live'
    );
  });

  it('rejects a disabled live source before fetching upstream', async () => {
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { EnableWebLive: true },
      LiveConfig: [{ key: 'live', disabled: true }],
    } as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET(
      new Request(
        'https://app.example/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Flive%2Findex.m3u8&moontv-source=live'
      )
    );

    expect(response.status).toBe(404);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('清單內容的 key／variant／分片各跨不同 host 都必須被記住（路徑互不頂替）', async () => {
    // 三條 remember 路徑各用獨立 host——拿掉任一路徑都會讓對應斷言紅
    // （先前 seg+variant 同 host 時，刪其一仍綠，守門比宣稱窄）
    const playlistUrl = 'https://cdn1.example/live/index.m3u8';
    const liveSourceUrl = 'https://cdn1.example/playlist.m3u';
    const keyUrl = 'https://key.example/k.bin';
    const variantUrl = 'https://variant.example/720.m3u8';
    const segmentUrl = 'https://seg.example/1.ts';
    const unknownUrl = 'https://unknown.example/evil.ts';

    const manifest = [
      '#EXTM3U',
      `#EXT-X-KEY:METHOD=AES-128,URI="${keyUrl}"`,
      '#EXT-X-STREAM-INF:BANDWIDTH=800000',
      variantUrl,
      '#EXTINF:4,',
      segmentUrl,
    ].join('\n');
    const upstream = new Response(manifest, {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
    });
    Object.defineProperty(upstream, 'url', { value: playlistUrl });
    mockedFetch.mockResolvedValue(upstream);
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { EnableWebLive: true },
      LiveConfig: [
        {
          key: 'live',
          ua: 'Custom UA',
          url: liveSourceUrl,
          name: 'live',
          from: 'custom',
        },
      ],
    } as Awaited<ReturnType<typeof getConfig>>);

    // 抓清單前：三個跨 CDN host 皆不可
    for (const url of [keyUrl, variantUrl, segmentUrl]) {
      expect(isUrlAllowedForLiveProxy('live', url, liveSourceUrl, [])).toBe(
        false
      );
    }

    const response = await GET(
      new Request(
        `https://app.example/api/proxy/m3u8?url=${encodeURIComponent(playlistUrl)}&moontv-source=live`,
        { headers: { host: 'app.example' } }
      )
    );
    expect(response.status).toBe(200);

    // tag URI → key.example
    expect(isUrlAllowedForLiveProxy('live', keyUrl, liveSourceUrl, [])).toBe(
      true
    );
    // STREAM-INF 下一行 → variant.example
    expect(
      isUrlAllowedForLiveProxy('live', variantUrl, liveSourceUrl, [])
    ).toBe(true);
    // 媒體行 → seg.example
    expect(
      isUrlAllowedForLiveProxy('live', segmentUrl, liveSourceUrl, [])
    ).toBe(true);
    // 從未出現在清單 → 仍拒
    expect(
      isUrlAllowedForLiveProxy('live', unknownUrl, liveSourceUrl, [])
    ).toBe(false);
  });

  it('does not remember a redirect host when the body is not a playlist', async () => {
    const upstream = new Response('not a playlist', { status: 200 });
    Object.defineProperty(upstream, 'url', {
      value: 'https://evil.example/payload',
    });
    mockedFetch.mockResolvedValue(upstream);
    mockedReadText.mockResolvedValue('not a playlist');

    const response = await GET(
      new Request(
        'https://app.example/api/proxy/m3u8?url=https%3A%2F%2Fcdn.example%2Flive%2Fmaster.m3u8&moontv-source=live',
        { headers: { host: 'app.example' } }
      )
    );

    expect(response.status).toBe(415);
    expect(
      isUrlAllowedForLiveProxy(
        'live',
        'https://evil.example/seg.ts',
        'https://cdn.example/playlist.m3u',
        []
      )
    ).toBe(false);
  });
});
