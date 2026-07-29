/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { POST } from './route';

jest.mock('@/lib/api-auth', () => ({ getVerifiedAuthInfo: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  setCachedConfig: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    saveAdminConfig: jest.fn(),
    registerUser: jest.fn(),
    changePassword: jest.fn(),
    deleteUser: jest.fn(),
    checkUserExist: jest.fn().mockResolvedValue(false),
  },
}));
jest.mock('@/lib/security-store', () => ({
  revokeUserSessions: jest.fn(),
}));

const mockedGetAuth = jest.mocked(getVerifiedAuthInfo);
const mockedGetConfig = jest.mocked(getConfig);
const mockedSaveConfig = jest.mocked(db.saveAdminConfig);

function request(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/user', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('/api/admin/user array validation', () => {
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
      UserConfig: {
        Users: [{ username: 'alice', role: 'user' }],
        Tags: [],
      },
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
  });

  afterAll(() => delete process.env.STORAGE_TYPE);

  it.each([
    {
      action: 'updateUserApis',
      targetUsername: 'alice',
      enabledApis: 'source-a',
    },
    {
      action: 'updateUserGroups',
      targetUsername: 'alice',
      userGroups: 'group-a',
    },
    {
      action: 'batchUpdateUserGroups',
      usernames: ['alice'],
      userGroups: [123],
    },
  ])('rejects malformed array fields for $action', async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });
});

/**
 * 使用者名會直接組成儲存鍵（u:<name>:pwd）。含冒號的帳號會污染命名空間：
 * `a:pwd` 產生 `u:a:pwd:pwd`，被名冊掃描的 /^u:(.+?):pwd$/ 非貪婪解析成
 * 不存在的帳號 `a`。同目錄的 /api/admin/source 驗證很完整，唯獨這裡沒有。
 */
describe('/api/admin/user 新增帳號的輸入驗證', () => {
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
      UserConfig: { Users: [{ username: 'alice', role: 'user' }], Tags: [] },
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
    jest.mocked(db.checkUserExist).mockResolvedValue(false);
  });

  afterAll(() => delete process.env.STORAGE_TYPE);

  it.each([
    ['含冒號', 'evil:pwd'],
    ['含萬用字元', 'a*b'],
    ['含空白', 'bad name'],
    ['空字串', ''],
    ['超過 64 字', 'x'.repeat(65)],
  ])('拒絕不合法的使用者名（%s）', async (_label, targetUsername) => {
    const response = await POST(
      request({ action: 'add', targetUsername, targetPassword: 'pw' })
    );

    expect(response.status).toBe(400);
    expect(db.registerUser).not.toHaveBeenCalled();
    expect(mockedSaveConfig).not.toHaveBeenCalled();
  });

  it('拒絕過長的密碼', async () => {
    const response = await POST(
      request({
        action: 'add',
        targetUsername: 'bob',
        targetPassword: 'x'.repeat(129),
      })
    );

    expect(response.status).toBe(400);
    expect(db.registerUser).not.toHaveBeenCalled();
  });

  it('資料庫已存在同名帳號時拒絕，避免覆寫既有密碼', async () => {
    jest.mocked(db.checkUserExist).mockResolvedValue(true);

    const response = await POST(
      request({ action: 'add', targetUsername: 'bob', targetPassword: 'pw' })
    );

    expect(response.status).toBe(400);
    expect(db.registerUser).not.toHaveBeenCalled();
  });

  it('合法的使用者名可以正常新增', async () => {
    const response = await POST(
      request({
        action: 'add',
        targetUsername: 'bob.smith_01@x-y',
        targetPassword: 'pw',
      })
    );

    expect(response.status).toBe(200);
    expect(db.registerUser).toHaveBeenCalledWith('bob.smith_01@x-y', 'pw');
  });
});
