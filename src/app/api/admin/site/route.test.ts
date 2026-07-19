/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { db } from '@/lib/db';

import { POST } from './route';

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/lib/api-auth', () => ({ getVerifiedAuthInfo: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  setCachedConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({ db: { saveAdminConfig: jest.fn() } }));

const mockedGetAuth = jest.mocked(getVerifiedAuthInfo);
const mockedSaveConfig = jest.mocked(db.saveAdminConfig);

describe('/api/admin/site', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STORAGE_TYPE = 'redis';
    mockedGetAuth.mockResolvedValue({
      username: 'owner',
      signature: 'signed',
      timestamp: Date.now(),
    });
  });

  afterAll(() => delete process.env.STORAGE_TYPE);

  it('rejects SearchDownstreamMaxPage above the hard limit', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/admin/site', {
        method: 'POST',
        body: JSON.stringify({
          SiteName: 'Site',
          Announcement: '',
          SearchDownstreamMaxPage: 21,
          SiteInterfaceCacheTime: 7200,
          DoubanProxyType: 'direct',
          DoubanProxy: '',
          DoubanImageProxyType: 'direct',
          DoubanImageProxy: '',
          DisableYellowFilter: false,
          FluidSearch: true,
          EnableWebLive: true,
        }),
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(response.status).toBe(400);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });
});
