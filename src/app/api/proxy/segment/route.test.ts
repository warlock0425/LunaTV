/** @jest-environment node */

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import { clearLiveProxyRememberedHosts } from '@/lib/live-proxy-allowlist';
import { fetchSafeRemoteUrl } from '@/lib/url-safety';

import { GET } from './route';

jest.mock('@/lib/api-auth', () => ({
  getVerifiedAuthInfo: jest.fn(),
}));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/url-safety', () => ({
  fetchSafeRemoteUrl: jest.fn(),
  isSafeRemoteUrl: jest.fn(() => true),
  UnsafeRemoteUrlError: class extends Error {},
}));

const mockedGetVerifiedAuth = jest.mocked(getVerifiedAuthInfo);
const mockedGetConfig = jest.mocked(getConfig);
const mockedFetch = jest.mocked(fetchSafeRemoteUrl);

describe('/api/proxy/segment', () => {
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

  it('forwards byte ranges and preserves partial-content metadata', async () => {
    mockedFetch.mockResolvedValue(
      new Response('data', {
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '4',
          'Content-Range': 'bytes 0-3/10',
          'Accept-Ranges': 'bytes',
        },
      })
    );
    const request = new Request(
      'http://localhost/api/proxy/segment?url=https%3A%2F%2Fcdn.example%2Fvideo.mp4&moontv-source=live',
      { headers: { Range: 'bytes=0-3' } }
    );

    const response = await GET(request);

    const upstreamHeaders = mockedFetch.mock.calls[0][1]?.headers as Headers;
    expect(upstreamHeaders.get('Range')).toBe('bytes=0-3');
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Type')).toBe('video/mp4');
    expect(response.headers.get('Content-Range')).toBe('bytes 0-3/10');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
  });

  it('preserves an upstream 416 response and its Content-Range header', async () => {
    mockedFetch.mockResolvedValue(
      new Response(null, {
        status: 416,
        headers: {
          'Content-Range': 'bytes */10',
          'Accept-Ranges': 'bytes',
        },
      })
    );

    const response = await GET(
      new Request(
        'http://localhost/api/proxy/segment?url=https%3A%2F%2Fcdn.example%2Fvideo.mp4&moontv-source=live',
        { headers: { Range: 'bytes=100-200' } }
      )
    );

    expect(response.status).toBe(416);
    expect(response.headers.get('Content-Range')).toBe('bytes */10');
    expect(response.headers.get('Accept-Ranges')).toBe('bytes');
  });

  it('rejects a disabled live source before fetching upstream', async () => {
    mockedGetConfig.mockResolvedValue({
      LiveConfig: [
        {
          key: 'live',
          disabled: true,
          url: 'https://cdn.example/playlist.m3u',
        },
      ],
    } as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET(
      new Request(
        'http://localhost/api/proxy/segment?url=https%3A%2F%2Fcdn.example%2Fvideo.mp4&moontv-source=live'
      )
    );

    expect(response.status).toBe(404);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('url 主機不屬於該直播源 → 403，且不向上游抓取', async () => {
    const response = await GET(
      new Request(
        'http://localhost/api/proxy/segment?url=https%3A%2F%2Fevil.example%2Fhuge.iso&moontv-source=live'
      )
    );

    expect(response.status).toBe(403);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('rejects oversized Content-Length before streaming', async () => {
    mockedFetch.mockResolvedValue(
      new Response('x', {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(60 * 1024 * 1024),
        },
      })
    );

    const response = await GET(
      new Request(
        'http://localhost/api/proxy/segment?url=https%3A%2F%2Fcdn.example%2Fvideo.mp4&moontv-source=live'
      )
    );

    expect(response.status).toBe(413);
  });
});
