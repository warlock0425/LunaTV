/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getValidUser } from '@/lib/config';

import { GET } from './route';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(() => ({ username: 'alice' })),
}));
jest.mock('@/lib/config', () => ({
  getValidUser: jest.fn(),
  getConfig: jest.fn(),
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/downstream', () => ({ searchFromApi: jest.fn() }));

const mockedGetValidUser = jest.mocked(getValidUser);

describe('/api/search/one', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetValidUser.mockResolvedValue({ username: 'alice', role: 'user' });
  });

  it('returns 400 when q or resourceId is missing', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/search/one?q=title')
    );

    expect(response.status).toBe(400);
  });
});
