/** @jest-environment node */

import { NextRequest } from 'next/server';
import { gzipSync } from 'node:zlib';

import { requireOwner } from '@/lib/api-auth';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { configSelfCheck, getConfig, setCachedConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { isHashed } from '@/lib/password';
import { getSessionVersion, revokeUserSessions } from '@/lib/security-store';

import { POST } from './route';

jest.mock('@/lib/api-auth', () => ({
  requireOwner: jest.fn(),
}));
jest.mock('@/lib/api-rate-limit', () => ({
  enforceRateLimit: jest.fn().mockResolvedValue(null),
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
    withAdminConfigLock: jest.fn(async (fn: () => Promise<unknown>) => fn()),
  },
}));
jest.mock('@/lib/password', () => ({
  isHashed: jest.fn(),
}));

/** 記憶體版 session store：模擬「讀不到 → 1」與 bump，禁止用刪 key 冒充撤銷 */
const sessionVersions = new Map<string, number>();
jest.mock('@/lib/security-store', () => ({
  getSessionVersion: jest.fn(async (username: string) => {
    return sessionVersions.get(username) ?? 1;
  }),
  revokeUserSessions: jest.fn(async (username: string) => {
    // 與 production Lua 一致：無 key 從 1 bump 到 2，有 key 則 +1
    const next = (sessionVersions.get(username) ?? 1) + 1;
    sessionVersions.set(username, next);
    return next;
  }),
}));

const mockedAuth = jest.mocked(requireOwner);
const mockedRateLimit = jest.mocked(enforceRateLimit);
const mockedConfigSelfCheck = jest.mocked(configSelfCheck);
const mockedGetConfig = jest.mocked(getConfig);
const mockedSetCachedConfig = jest.mocked(setCachedConfig);
const mockedDecrypt = jest.mocked(SimpleCrypto.decrypt);
const mockedIsHashed = jest.mocked(isHashed);
const mockedGetSessionVersion = jest.mocked(getSessionVersion);
const mockedRevokeUserSessions = jest.mocked(revokeUserSessions);
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
    headers: {
      origin: 'http://localhost',
      host: 'localhost',
    },
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
    sessionVersions.clear();
    process.env.STORAGE_TYPE = 'redis';
    process.env.USERNAME = 'owner';
    mockedAuth.mockResolvedValue({
      username: 'owner',
      auth: { username: 'owner' },
    } as never);
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

  it('import 成功後一般使用者 sessionVersion 必須變大；站長不變', async () => {
    // 模擬站上已有有效 session（version=1，與預設 cookie 相同）
    sessionVersions.set('alice', 1);
    sessionVersions.set('owner', 1);
    const aliceBefore = await mockedGetSessionVersion('alice');
    const ownerBefore = await mockedGetSessionVersion('owner');
    expect(aliceBefore).toBe(1);
    expect(ownerBefore).toBe(1);

    const response = await POST(
      createImportRequest({
        data: {
          adminConfig: {
            ...existingConfig,
            UserConfig: {
              Users: [{ username: 'alice', role: 'user', banned: false }],
            },
          },
          userData: {
            alice: {
              password: 'new-password-hash',
              playRecords: {},
              favorites: {},
              searchHistory: [],
              skipConfigs: {},
            },
          },
        },
      })
    );

    expect(response.status).toBe(200);

    const aliceAfter = await mockedGetSessionVersion('alice');
    const ownerAfter = await mockedGetSessionVersion('owner');
    // 一般使用者：密碼／資料已被匯入換掉，必須 bump
    expect(aliceAfter).toBeGreaterThan(aliceBefore);
    expect(mockedRevokeUserSessions).toHaveBeenCalledWith('alice');
    // 若只刪 key 而不 bump：下次讀回仍是 1，舊 cookie 仍 match
    expect(sessionVersions.get('alice')).toBe(2);
    expect(sessionVersions.has('alice')).toBe(true);

    // 站長：憑證在環境變數，匯入改不到；撤銷只會讓「重新整理」撞 401
    expect(ownerAfter).toBe(ownerBefore);
    expect(mockedRevokeUserSessions).not.toHaveBeenCalledWith('owner');
  });

  it('import 中途失敗並還原時不撤銷 session（舊 cookie 仍應對回滾資料有效）', async () => {
    sessionVersions.set('alice', 1);
    mockedDb.saveAdminConfig
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);

    const response = await POST(
      createImportRequest({
        data: { adminConfig: existingConfig, userData: {} },
      })
    );

    expect(response.status).toBe(500);
    expect(mockedRevokeUserSessions).not.toHaveBeenCalled();
    expect(await mockedGetSessionVersion('alice')).toBe(1);
  });

  it('rate-limits repeated import attempts', async () => {
    mockedRateLimit.mockResolvedValue(
      new Response(JSON.stringify({ error: '請求過於頻繁，請稍後再試' }), {
        status: 429,
      }) as never
    );

    const response = await POST(
      createImportRequest({
        data: { adminConfig: existingConfig, userData: {} },
      })
    );

    expect(response.status).toBe(429);
    expect(mockedDb.clearAllData).not.toHaveBeenCalled();
  });
});
