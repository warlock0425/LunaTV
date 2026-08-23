/** @jest-environment node */

import { NextRequest } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { revokeUserSessions } from '@/lib/security-store';

import { POST } from './route';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
}));
jest.mock('@/lib/security-store', () => ({
  revokeUserSessions: jest.fn(),
}));

const mockedAuth = jest.mocked(requireActiveUser);
const mockedRevoke = jest.mocked(revokeUserSessions);

function logoutRequest(url: string, origin?: string) {
  const headers = new Headers();
  if (origin) {
    headers.set('origin', origin);
    headers.set('host', 'localhost');
  }
  return new NextRequest(url, { method: 'POST', headers });
}

describe('/api/logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockResolvedValue({ username: 'alice' } as never);
    mockedRevoke.mockResolvedValue(2);
  });

  it('預設只清 cookie，不撤銷其他裝置', async () => {
    const response = await POST(logoutRequest('http://localhost/api/logout'));
    expect(response.status).toBe(200);
    expect(mockedRevoke).not.toHaveBeenCalled();
  });

  it('預設登出若帶跨站 Origin 則回 403', async () => {
    const response = await POST(
      logoutRequest('http://localhost/api/logout', 'https://evil.example')
    );
    expect(response.status).toBe(403);
    expect(mockedRevoke).not.toHaveBeenCalled();
  });

  it('?all=true 時撤銷所有裝置 session', async () => {
    const response = await POST(
      logoutRequest('http://localhost/api/logout?all=true', 'http://localhost')
    );
    expect(response.status).toBe(200);
    expect(mockedRevoke).toHaveBeenCalledWith('alice');
  });

  it('?all=true 缺少 Origin 時回 403', async () => {
    const response = await POST(
      logoutRequest('http://localhost/api/logout?all=true')
    );
    expect(response.status).toBe(403);
    expect(mockedRevoke).not.toHaveBeenCalled();
  });

  it('?all=true 但未登入時仍清 cookie、不撤銷', async () => {
    mockedAuth.mockResolvedValue(null);
    const response = await POST(
      logoutRequest('http://localhost/api/logout?all=true', 'http://localhost')
    );
    expect(response.status).toBe(200);
    expect(mockedRevoke).not.toHaveBeenCalled();
  });
});
