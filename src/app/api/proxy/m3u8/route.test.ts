/** @jest-environment node */

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
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
    process.env.STORAGE_TYPE = 'localstorage';
    process.env.PASSWORD = 'secret';
    mockedGetVerifiedAuth.mockResolvedValue({
      username: 'localstorage',
      signature: 'signed',
      timestamp: Date.now(),
    });
    mockedGetConfig.mockResolvedValue({
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
});
