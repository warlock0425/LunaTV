/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import {
  fetchSafeRemoteUrl,
  readResponseTextWithLimit,
} from '@/lib/url-safety';

import { GET } from './route';

jest.mock('@/lib/api-auth', () => ({ getVerifiedAuthInfo: jest.fn() }));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/url-safety', () => ({
  fetchSafeRemoteUrl: jest.fn(),
  readResponseTextWithLimit: jest.fn(),
  UnsafeRemoteUrlError: class extends Error {},
}));

const mockedGetVerifiedAuth = jest.mocked(getVerifiedAuthInfo);
const mockedGetConfig = jest.mocked(getConfig);
const mockedFetch = jest.mocked(fetchSafeRemoteUrl);
const mockedReadText = jest.mocked(readResponseTextWithLimit);

function signedIn() {
  mockedGetVerifiedAuth.mockResolvedValue({
    username: 'localstorage',
    signature: 'signed',
    timestamp: Date.now(),
  });
}

function request() {
  return new NextRequest(
    'http://localhost/api/live/precheck?url=https%3A%2F%2Fcdn.example%2Flive&moontv-source=live'
  );
}

describe('/api/live/precheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signedIn();
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { EnableWebLive: true },
      LiveConfig: [
        {
          key: 'live',
          ua: 'Test UA',
          url: 'https://cdn.example/playlist.m3u',
        },
      ],
    } as Awaited<ReturnType<typeof getConfig>>);
  });

  it('未登入時回 401，且不會對外發出請求', async () => {
    mockedGetVerifiedAuth.mockResolvedValue(null);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('網頁直播關閉時回 403，且不會對外發出請求', async () => {
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { EnableWebLive: false },
      LiveConfig: [
        {
          key: 'live',
          ua: 'Test UA',
          url: 'https://cdn.example/playlist.m3u',
        },
      ],
    } as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('rejects HTML instead of labelling it as m3u8', async () => {
    mockedFetch.mockResolvedValue(
      new Response('<html>login</html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );

    const response = await GET(request());

    expect(response.status).toBe(415);
    expect(mockedReadText).not.toHaveBeenCalled();
  });

  it('accepts a manifest only after checking its EXTM3U signature', async () => {
    const upstream = new Response('#EXTM3U');
    mockedFetch.mockResolvedValue(upstream);
    mockedReadText.mockResolvedValue('#EXTM3U\n#EXTINF:1,One');

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      type: 'm3u8',
    });
    expect(mockedReadText).toHaveBeenCalledWith(upstream, 512 * 1024);
  });

  it('rejects a host that does not belong to the live source', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/live/precheck?url=https%3A%2F%2Fevil.example%2Flive&moontv-source=live'
      )
    );

    expect(response.status).toBe(403);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('rejects a disabled source before fetching upstream', async () => {
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { EnableWebLive: true },
      LiveConfig: [
        {
          key: 'live',
          disabled: true,
          url: 'https://cdn.example/playlist.m3u',
        },
      ],
    } as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
