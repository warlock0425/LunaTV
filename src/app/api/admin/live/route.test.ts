/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { getFreshConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { deleteCachedLiveChannels, refreshLiveChannels } from '@/lib/live';

import { POST } from './route';

jest.mock('@/lib/api-auth', () => ({ getVerifiedAuthInfo: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getFreshConfig: jest.fn(),
  setCachedConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    saveAdminConfig: jest.fn(),
    withAdminConfigLock: jest.fn(async (fn: () => Promise<unknown>) => fn()),
  },
}));
jest.mock('@/lib/live', () => ({
  deleteCachedLiveChannels: jest.fn(),
  refreshLiveChannels: jest.fn(),
}));

const mockedGetAuth = jest.mocked(getVerifiedAuthInfo);
const mockedGetConfig = jest.mocked(getFreshConfig);
const mockedSaveConfig = jest.mocked(db.saveAdminConfig);
const mockedDeleteCache = jest.mocked(deleteCachedLiveChannels);
const mockedRefresh = jest.mocked(refreshLiveChannels);

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/live', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      origin: 'http://localhost',
      host: 'localhost',
    },
  });
}

describe('/api/admin/live', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USERNAME = 'owner';
    mockedGetAuth.mockResolvedValue({
      username: 'owner',
      signature: 'signed',
      timestamp: Date.now(),
    });
    mockedGetConfig.mockResolvedValue({
      UserConfig: { Users: [] },
      LiveConfig: [
        {
          key: 'live',
          name: 'Live',
          url: 'https://example.test/live.m3u',
          from: 'custom',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getFreshConfig>>);
  });

  it('rejects an add action with missing or malformed fields', async () => {
    const response = await POST(
      request({ action: 'add', key: 'new-live', name: 'New' })
    );

    expect(response.status).toBe(400);
    expect(mockedRefresh).not.toHaveBeenCalled();
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });

  it('rejects duplicate keys in the sort order', async () => {
    const response = await POST(
      request({ action: 'sort', order: ['live', 'live'] })
    );

    expect(response.status).toBe(400);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });

  it('clears the live cache when disabling a source', async () => {
    const response = await POST(request({ action: 'disable', key: 'live' }));

    expect(response.status).toBe(200);
    expect(mockedDeleteCache).toHaveBeenCalledWith('live');
    expect(mockedSaveConfig).toHaveBeenCalled();
  });
});
