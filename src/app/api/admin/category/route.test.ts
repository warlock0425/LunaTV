/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { POST } from './route';

jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  setCachedConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({ db: { saveAdminConfig: jest.fn() } }));

const mockedGetAuth = jest.mocked(getAuthInfoFromCookie);
const mockedGetConfig = jest.mocked(getConfig);
const mockedSaveConfig = jest.mocked(db.saveAdminConfig);

describe('/api/admin/category', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'owner';
    mockedGetAuth.mockReturnValue({
      username: 'owner',
      signature: 'signed',
      timestamp: Date.now(),
    });
    mockedGetConfig.mockResolvedValue({
      UserConfig: { Users: [] },
      CustomCategories: [],
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
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
        headers: { 'Content-Type': 'application/json' },
      })
    );

    expect(response.status).toBe(400);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });
});
