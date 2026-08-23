/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import { getCachedLiveChannels } from '@/lib/live';

import { GET } from './route';

jest.mock('@/lib/api-auth', () => ({ getVerifiedAuthInfo: jest.fn() }));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/live', () => ({
  getCachedLiveChannels: jest.fn(),
  isWebLiveEnabled: jest.fn(
    (config: { SiteConfig?: { EnableWebLive?: boolean } }) =>
      config?.SiteConfig?.EnableWebLive === true
  ),
  WEB_LIVE_DISABLED_MESSAGE: '網頁直播未開啟',
}));

const mockedGetVerifiedAuth = jest.mocked(getVerifiedAuthInfo);
const mockedGetConfig = jest.mocked(getConfig);
const mockedGetCachedLiveChannels = jest.mocked(getCachedLiveChannels);

describe('/api/live/epg', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetVerifiedAuth.mockResolvedValue({
      username: 'localstorage',
      signature: 'signed',
      timestamp: Date.now(),
    });
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { EnableWebLive: true },
    } as Awaited<ReturnType<typeof getConfig>>);
  });

  it('未登入時回 401，且不會讀取頻道資料', async () => {
    mockedGetVerifiedAuth.mockResolvedValue(null);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/live/epg?source=live&tvgId=channel-1'
      )
    );

    expect(response.status).toBe(401);
    expect(mockedGetCachedLiveChannels).not.toHaveBeenCalled();
  });

  it('returns 404 when the source does not exist or is disabled', async () => {
    mockedGetCachedLiveChannels.mockResolvedValue(null);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/live/epg?source=missing&tvgId=channel-1'
      )
    );

    expect(response.status).toBe(404);
  });
});
