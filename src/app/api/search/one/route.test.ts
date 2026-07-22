/** @jest-environment node */

import { NextRequest } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';

import { GET } from './route';

jest.mock('@/lib/api-auth', () => ({
  requireActiveUser: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/downstream', () => ({ searchFromApi: jest.fn() }));

const mockedRequireActiveUser = jest.mocked(requireActiveUser);

describe('/api/search/one', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireActiveUser.mockResolvedValue({
      username: 'alice',
      auth: { username: 'alice' },
    } as Awaited<ReturnType<typeof requireActiveUser>>);
  });

  it('returns 400 when q or resourceId is missing', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/search/one?q=title')
    );

    expect(response.status).toBe(400);
  });

  it('returns 401 when session is not verified', async () => {
    mockedRequireActiveUser.mockResolvedValue(null);
    const response = await GET(
      new NextRequest('http://localhost/api/search/one?q=title&resourceId=demo')
    );
    expect(response.status).toBe(401);
  });
});
