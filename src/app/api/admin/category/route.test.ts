/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { getFreshConfig } from '@/lib/config';
import { db } from '@/lib/db';

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

const mockedGetAuth = jest.mocked(getVerifiedAuthInfo);
const mockedGetConfig = jest.mocked(getFreshConfig);
const mockedSaveConfig = jest.mocked(db.saveAdminConfig);

describe('/api/admin/category', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'owner';
    mockedGetAuth.mockResolvedValue({
      username: 'owner',
      signature: 'signed',
      timestamp: Date.now(),
    });
    mockedGetConfig.mockResolvedValue({
      UserConfig: { Users: [] },
      CustomCategories: [],
    } as unknown as Awaited<ReturnType<typeof getFreshConfig>>);
  });

  afterAll(() => delete process.env.STORAGE_TYPE);

  it('rejects a category type outside movie and tv', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/admin/category', {
        method: 'POST',
        body: JSON.stringify({
          action: 'add',
          name: 'Bad',
          type: 'sports',
          query: 'bad',
        }),
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost',
          host: 'localhost',
        },
      })
    );

    expect(response.status).toBe(400);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });
});
