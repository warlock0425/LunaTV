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

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/source', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('/api/admin/source', () => {
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
      UserConfig: { Users: [], Tags: [] },
      SourceConfig: [],
    } as unknown as Awaited<ReturnType<typeof getFreshConfig>>);
  });

  afterAll(() => delete process.env.STORAGE_TYPE);

  it('rejects a source key containing the storage-key delimiter', async () => {
    const response = await POST(
      request({
        action: 'add',
        key: 'bad+key',
        name: 'Bad',
        api: 'https://example.test/api',
      })
    );

    expect(response.status).toBe(400);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });

  it('rejects an add action without required fields', async () => {
    const response = await POST(
      request({ action: 'add', key: 'valid', api: 'https://example.test/api' })
    );

    expect(response.status).toBe(400);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });
});
