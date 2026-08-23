/** @jest-environment node */

import { NextRequest } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';
import {
  clearLoginAttempts,
  consumeLoginAttempt,
  revokeUserSessions,
} from '@/lib/security-store';

import { POST } from './route';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
}));
jest.mock('@/lib/db', () => ({
  db: {
    verifyUser: jest.fn(),
    changePassword: jest.fn(),
  },
}));
jest.mock('@/lib/security-store', () => ({
  clearLoginAttempts: jest.fn(),
  consumeLoginAttempt: jest.fn(),
  revokeUserSessions: jest.fn(),
}));
jest.mock('@/lib/storage-runtime', () => ({
  getServerStorageType: () => 'redis',
}));

const mockedAuth = jest.mocked(requireActiveUser);
const mockedVerify = jest.mocked(db.verifyUser);
const mockedChange = jest.mocked(db.changePassword);
const mockedConsume = jest.mocked(consumeLoginAttempt);
const mockedClear = jest.mocked(clearLoginAttempts);
const mockedRevoke = jest.mocked(revokeUserSessions);

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/change-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: 'http://localhost',
      host: 'localhost',
    },
    body: JSON.stringify(body),
  });
}

describe('change-password API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USERNAME = 'owner';
    mockedAuth.mockResolvedValue({ username: 'alice' } as never);
    mockedConsume.mockResolvedValue({ blocked: false, retryAfter: 0 });
    mockedClear.mockResolvedValue(undefined);
    mockedRevoke.mockResolvedValue(0);
    mockedVerify.mockResolvedValue(true);
    mockedChange.mockResolvedValue(undefined);
  });

  it('缺少 Origin 時回 403 且不改密', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', host: 'localhost' },
        body: JSON.stringify({
          currentPassword: 'old-pass',
          newPassword: 'new-pass-1',
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(mockedChange).not.toHaveBeenCalled();
  });

  it('連續失敗達上限後回 429 且不呼叫 changePassword', async () => {
    mockedConsume.mockResolvedValue({ blocked: true, retryAfter: 900 });
    mockedVerify.mockResolvedValue(false);

    const response = await POST(
      request({ currentPassword: 'wrong', newPassword: 'new-pass-1' })
    );

    expect(response.status).toBe(429);
    expect(mockedChange).not.toHaveBeenCalled();
    expect(mockedConsume).toHaveBeenCalledWith('changepw:user:alice', 5, 900);
  });

  it('目前密碼錯誤時計數已消耗且不改密', async () => {
    mockedVerify.mockResolvedValue(false);

    const response = await POST(
      request({ currentPassword: 'wrong', newPassword: 'new-pass-1' })
    );

    expect(response.status).toBe(401);
    expect(mockedChange).not.toHaveBeenCalled();
    expect(mockedClear).not.toHaveBeenCalled();
    expect(mockedConsume).toHaveBeenCalled();
  });

  it('站長無法於線上改密', async () => {
    mockedAuth.mockResolvedValue({ username: 'owner' } as never);
    const response = await POST(
      request({ currentPassword: 'old-pass', newPassword: 'new-pass-1' })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '站長密碼由部署環境變數 PASSWORD 控制，無法於線上修改',
    });
    expect(mockedChange).not.toHaveBeenCalled();
  });

  it('成功改密後清除失敗計數', async () => {
    const response = await POST(
      request({ currentPassword: 'old-pass', newPassword: 'new-pass-1' })
    );

    expect(response.status).toBe(200);
    expect(mockedClear).toHaveBeenCalledWith('changepw:user:alice');
    expect(mockedChange).toHaveBeenCalledWith('alice', 'new-pass-1');
    expect(mockedRevoke).toHaveBeenCalledWith('alice');
  });
});
