/** @jest-environment node */

import { NextRequest } from 'next/server';
import { gzipSync } from 'node:zlib';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { configSelfCheck, getConfig, setCachedConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { isHashed } from '@/lib/password';

import { POST } from './route';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  configSelfCheck: jest.fn(),
  getConfig: jest.fn(),
  setCachedConfig: jest.fn(),
}));
jest.mock('@/lib/crypto', () => ({
  SimpleCrypto: { decrypt: jest.fn() },
}));
jest.mock('@/lib/db', () => ({
  db: {
    storage: {
      client: {
        get: jest.fn(),
        set: jest.fn(),
        sAdd: jest.fn(),
      },
      setPlayRecord: jest.fn(),
      setFavorite: jest.fn(),
    },
    getAllUsers: jest.fn(),
    getAllPlayRecords: jest.fn(),
    getAllFavorites: jest.fn(),
    getSearchHistory: jest.fn(),
    getAllSkipConfigs: jest.fn(),
    addSearchHistory: jest.fn(),
    setSkipConfig: jest.fn(),
    registerUser: jest.fn(),
    deleteUser: jest.fn(),
    clearAllData: jest.fn(),
    saveAdminConfig: jest.fn(),
  },
}));
jest.mock('@/lib/password', () => ({
  isHashed: jest.fn(),
}));

const mockedAuth = jest.mocked(getAuthInfoFromCookie);
const mockedConfigSelfCheck = jest.mocked(configSelfCheck);
const mockedGetConfig = jest.mocked(getConfig);
const mockedSetCachedConfig = jest.mocked(setCachedConfig);
const mockedDecrypt = jest.mocked(SimpleCrypto.decrypt);
const mockedIsHashed = jest.mocked(isHashed);
const mockedDb = db as unknown as {
  storage: {
    client: {
      get: jest.Mock;
      set: jest.Mock;
      sAdd: jest.Mock;
    };
    setPlayRecord: jest.Mock;
    setFavorite: jest.Mock;
  };
  getAllUsers: jest.Mock;
  getAllPlayRecords: jest.Mock;
  getAllFavorites: jest.Mock;
  getSearchHistory: jest.Mock;
  getAllSkipConfigs: jest.Mock;
  addSearchHistory: jest.Mock;
  setSkipConfig: jest.Mock;
  registerUser: jest.Mock;
  deleteUser: jest.Mock;
  clearAllData: jest.Mock;
  saveAdminConfig: jest.Mock;
};

function createImportRequest(payload: unknown): NextRequest {
  mockedDecrypt.mockReturnValue(
    gzipSync(JSON.stringify(payload)).toString('base64')
  );
  const form = new FormData();
  form.set('file', new File(['encrypted'], 'backup.dat'));
  form.set('password', 'backup-password');
  return new NextRequest('http://localhost/api/admin/data_migration/import', {
    method: 'POST',
    body: form,
  });
}

const existingConfig = {
  SiteConfig: {},
  UserConfig: { Users: [] },
  SourceConfig: [],
  CustomCategories: [],
  LiveConfig: [],
};

describe('data migration import', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'owner';
    mockedAuth.mockReturnValue({ username: 'owner' });
    mockedConfigSelfCheck.mockImplementation((config) => config);
    mockedGetConfig.mockResolvedValue(existingConfig as never);
    mockedDb.getAllUsers.mockResolvedValue(['alice']);
    mockedDb.getAllPlayRecords.mockResolvedValue({
      'source+1': { title: '舊紀錄' },
    } as never);
    mockedDb.getAllFavorites.mockResolvedValue({
      'source+2': { title: '舊收藏' },
    } as never);
    mockedDb.getSearchHistory.mockResolvedValue(['新搜尋', '舊搜尋']);
    mockedDb.getAllSkipConfigs.mockResolvedValue({
      'source+3': { enable: true, intro_time: 10, outro_time: 20 },
    });
    mockedDb.storage.client.get.mockResolvedValue('old-password-hash');
    mockedIsHashed.mockReturnValue(false);
  });

  it('rejects malformed configuration before clearing existing data', async () => {
    const response = await POST(
      createImportRequest({ data: { adminConfig: null, userData: {} } })
    );

    expect(response.status).toBe(400);
    expect(mockedDb.clearAllData).not.toHaveBeenCalled();
  });

  it('rejects an empty configuration object before clearing existing data', async () => {
    const response = await POST(
      createImportRequest({ data: { adminConfig: {}, userData: {} } })
    );

    expect(response.status).toBe(400);
    expect(mockedDb.clearAllData).not.toHaveBeenCalled();
  });

  it('does not clear data when the pre-import backup is incomplete', async () => {
    mockedDb.getAllSkipConfigs.mockRejectedValueOnce(
      new Error('backup read failed')
    );

    const response = await POST(
      createImportRequest({
        data: { adminConfig: existingConfig, userData: {} },
      })
    );

    expect(response.status).toBe(500);
    expect(mockedDb.clearAllData).not.toHaveBeenCalled();
  });

  it('rejects a configured user without restorable login data', async () => {
    const response = await POST(
      createImportRequest({
        data: {
          adminConfig: {
            ...existingConfig,
            UserConfig: {
              Users: [{ username: 'alice', role: 'user', banned: false }],
            },
          },
          userData: {},
        },
      })
    );

    expect(response.status).toBe(400);
    expect(mockedDb.clearAllData).not.toHaveBeenCalled();
    expect(mockedDb.saveAdminConfig).not.toHaveBeenCalled();
  });

  it('restores every backed-up user data type when import setup fails', async () => {
    mockedDb.saveAdminConfig
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);

    const response = await POST(
      createImportRequest({
        data: { adminConfig: existingConfig, userData: {} },
      })
    );

    expect(response.status).toBe(500);
    expect(mockedDb.clearAllData).toHaveBeenCalledTimes(2);
    expect(mockedDb.addSearchHistory.mock.calls).toEqual(
      expect.arrayContaining([
        ['alice', '舊搜尋'],
        ['alice', '新搜尋'],
      ])
    );
    expect(mockedDb.setSkipConfig).toHaveBeenCalledWith(
      'alice',
      'source',
      '3',
      { enable: true, intro_time: 10, outro_time: 20 }
    );
    expect(mockedSetCachedConfig).toHaveBeenCalledWith(existingConfig);
  });

  it('registers imported hashed-password users in the canonical user set', async () => {
    mockedDb.getAllUsers.mockResolvedValue([]);
    mockedIsHashed.mockReturnValue(true);

    const response = await POST(
      createImportRequest({
        data: {
          adminConfig: existingConfig,
          userData: { alice: { password: 'stored-hash' } },
        },
      })
    );

    expect(response.status).toBe(200);
    expect(mockedDb.storage.client.set).toHaveBeenCalledWith(
      'u:alice:pwd',
      'stored-hash'
    );
    expect(mockedDb.storage.client.sAdd).toHaveBeenCalledWith(
      'sys:users',
      'alice'
    );
  });
});
