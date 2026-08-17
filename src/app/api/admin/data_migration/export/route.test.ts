/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { getServerStorageType } from '@/lib/storage-runtime';

import { POST } from './route';

jest.mock('@/lib/api-auth', () => ({
  getVerifiedAuthInfo: jest.fn(),
}));
jest.mock('@/lib/api-rate-limit', () => ({
  enforceRateLimit: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/crypto', () => ({
  SimpleCrypto: { encrypt: jest.fn(() => 'encrypted-backup') },
}));
jest.mock('@/lib/db', () => ({
  db: {
    storage: { client: { get: jest.fn() } },
    getAdminConfig: jest.fn(),
    getAllUsers: jest.fn(),
    getAllPlayRecords: jest.fn(),
    getAllFavorites: jest.fn(),
    getSearchHistory: jest.fn(),
    getAllSkipConfigs: jest.fn(),
  },
}));
jest.mock('@/lib/storage-runtime', () => ({
  getServerStorageType: jest.fn(),
}));

const mockedAuth = jest.mocked(getVerifiedAuthInfo);
const mockedRateLimit = jest.mocked(enforceRateLimit);
const mockedEncrypt = jest.mocked(SimpleCrypto.encrypt);
const mockedStorageType = jest.mocked(getServerStorageType);
const mockedDb = db as unknown as {
  storage: { client: { get: jest.Mock } };
  getAdminConfig: jest.Mock;
  getAllUsers: jest.Mock;
  getAllPlayRecords: jest.Mock;
  getAllFavorites: jest.Mock;
  getSearchHistory: jest.Mock;
  getAllSkipConfigs: jest.Mock;
};

describe('data migration export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USERNAME = 'owner';
    mockedStorageType.mockReturnValue('redis');
    mockedRateLimit.mockResolvedValue(null);
    mockedAuth.mockResolvedValue({ username: 'owner' });
    mockedDb.getAdminConfig.mockResolvedValue({
      SiteConfig: {},
      UserConfig: {
        Users: [
          { username: 'owner', role: 'owner', banned: false },
          { username: 'alice', role: 'user', banned: false },
        ],
      },
      SourceConfig: [],
      CustomCategories: [],
      LiveConfig: [],
    } as never);
    mockedDb.getAllUsers.mockResolvedValue([]);
    mockedDb.getAllPlayRecords.mockResolvedValue({});
    mockedDb.getAllFavorites.mockResolvedValue({});
    mockedDb.getSearchHistory.mockResolvedValue([]);
    mockedDb.getAllSkipConfigs.mockResolvedValue({});
    mockedDb.storage.client.get.mockResolvedValue('stored-password');
  });

  it('exports configured users even when the user index is missing them', async () => {
    const request = new NextRequest(
      'http://localhost/api/admin/data_migration/export',
      {
        method: 'POST',
        body: JSON.stringify({ password: 'backup-password' }),
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost',
          host: 'localhost',
        },
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockedDb.getAllPlayRecords).toHaveBeenCalledWith('alice');
    expect(mockedDb.getAllFavorites).toHaveBeenCalledWith('alice');
    expect(mockedEncrypt).toHaveBeenCalledWith(
      expect.any(String),
      'backup-password'
    );
  });

  it('rate-limits repeated export attempts', async () => {
    mockedRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: '請求過於頻繁，請稍後再試' }), {
        status: 429,
      }) as never
    );

    const response = await POST(
      new NextRequest('http://localhost/api/admin/data_migration/export', {
        method: 'POST',
        body: JSON.stringify({ password: 'backup-password' }),
        headers: {
          'Content-Type': 'application/json',
          origin: 'http://localhost',
          host: 'localhost',
        },
      })
    );

    expect(response.status).toBe(429);
    expect(mockedEncrypt).not.toHaveBeenCalled();
  });
});
