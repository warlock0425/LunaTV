/** @jest-environment node */

import { NextRequest } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites } from '@/lib/config';
import {
  DownstreamNotFoundError,
  DownstreamTimeoutError,
  DownstreamUpstreamError,
  getDetailFromApi,
} from '@/lib/downstream';

import { GET } from './route';

jest.mock('@/lib/api-auth', () => ({ requireActiveUser: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getAvailableApiSites: jest.fn(),
}));
jest.mock('@/lib/downstream', () => {
  const actual =
    jest.requireActual<typeof import('@/lib/downstream')>('@/lib/downstream');
  return { ...actual, getDetailFromApi: jest.fn() };
});

const mockedRequireActiveUser = jest.mocked(requireActiveUser);
const mockedGetAvailableApiSites = jest.mocked(getAvailableApiSites);
const mockedGetDetail = jest.mocked(getDetailFromApi);

describe('detail API downstream error mapping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRequireActiveUser.mockResolvedValue({
      username: 'alice',
      auth: { username: 'alice' },
    } as Awaited<ReturnType<typeof requireActiveUser>>);
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

  it('rejects unverified sessions', async () => {
    mockedRequireActiveUser.mockResolvedValue(null);
    const response = await GET(
      new NextRequest('http://localhost/api/detail?source=test&id=123')
    );
    expect(response.status).toBe(401);
    expect(mockedGetDetail).not.toHaveBeenCalled();
  });
});
