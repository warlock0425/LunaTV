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
jest.mock('@/lib/db', () => ({
  db: {
    saveAdminConfig: jest.fn(),
    registerUser: jest.fn(),
    changePassword: jest.fn(),
    deleteUser: jest.fn(),
  },
}));
jest.mock('@/lib/security-store', () => ({
  revokeUserSessions: jest.fn(),
}));

const mockedGetAuth = jest.mocked(getAuthInfoFromCookie);
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
    mockedGetAuth.mockReturnValue({
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
