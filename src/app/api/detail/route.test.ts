/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getValidUser } from '@/lib/config';
import {
  DownstreamNotFoundError,
  DownstreamTimeoutError,
  DownstreamUpstreamError,
  getDetailFromApi,
} from '@/lib/downstream';

import { GET } from './route';

jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getAvailableApiSites: jest.fn(),
  getValidUser: jest.fn(),
}));
jest.mock('@/lib/downstream', () => {
  const actual =
    jest.requireActual<typeof import('@/lib/downstream')>('@/lib/downstream');
  return { ...actual, getDetailFromApi: jest.fn() };
});

const mockedGetAuthInfo = jest.mocked(getAuthInfoFromCookie);
const mockedGetValidUser = jest.mocked(getValidUser);
const mockedGetAvailableApiSites = jest.mocked(getAvailableApiSites);
const mockedGetDetail = jest.mocked(getDetailFromApi);

describe('detail API downstream error mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAuthInfo.mockReturnValue({ username: 'alice' } as never);
    mockedGetValidUser.mockResolvedValue({ username: 'alice' } as never);
    mockedGetAvailableApiSites.mockResolvedValue([
      {
        key: 'test',
        api: 'https://example.test/api.php/provide/vod',
        name: 'Test',
      },
    ]);
  });

  it.each([
    [new DownstreamNotFoundError(), 404],
    [new DownstreamUpstreamError(), 502],
    [new DownstreamTimeoutError(), 504],
  ])('maps %s to HTTP %i', async (error, expectedStatus) => {
    mockedGetDetail.mockRejectedValue(error);

    const response = await GET(
      new NextRequest('http://localhost/api/detail?source=test&id=123')
    );

    expect(response.status).toBe(expectedStatus);
  });

  it('keeps unexpected internal errors as HTTP 500 without exposing details', async () => {
    mockedGetDetail.mockRejectedValue(
      new Error('secret implementation detail')
    );

    const response = await GET(
      new NextRequest('http://localhost/api/detail?source=test&id=123')
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Internal server error',
    });
  });
});
