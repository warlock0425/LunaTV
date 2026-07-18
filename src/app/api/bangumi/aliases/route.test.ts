import { fetchBangumiSubjectAliases } from '@/lib/bangumi-aliases';
import { db } from '@/lib/db';

import { GET } from './route';

jest.mock('@/lib/bangumi-aliases', () => ({
  fetchBangumiSubjectAliases: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {
    getBangumiAliasCache: jest.fn(),
    setBangumiAliasCache: jest.fn(),
  },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: HeadersInit }) =>
      ({
        status: init?.status || 200,
        headers: init?.headers || {},
        json: async () => body,
      }) as Response,
  },
}));

const mockedFetchAliases = fetchBangumiSubjectAliases as jest.MockedFunction<
  typeof fetchBangumiSubjectAliases
>;
const mockedDb = db as unknown as {
  getBangumiAliasCache: jest.Mock;
  setBangumiAliasCache: jest.Mock;
};

function requestFor(id: string) {
  return {
    url: `http://localhost/api/bangumi/aliases?id=${id}`,
  } as Request;
}

describe('/api/bangumi/aliases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for invalid id', async () => {
    const response = await GET(requestFor('abc'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ aliases: [] });
  });

  it('uses persistent cache before fetching Bangumi', async () => {
    mockedDb.getBangumiAliasCache.mockResolvedValueOnce({
      aliases: ['Cached Alias'],
      expiresAt: Date.now() + 60_000,
    });

    const response = await GET(requestFor('777001'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ aliases: ['Cached Alias'] });
    expect(mockedFetchAliases).not.toHaveBeenCalled();
  });

  it('fetches and persists aliases when persistent cache misses', async () => {
    mockedDb.getBangumiAliasCache.mockResolvedValueOnce(null);
    mockedFetchAliases.mockResolvedValueOnce(['Fresh Alias']);

    const response = await GET(requestFor('777002'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ aliases: ['Fresh Alias'] });
    expect(mockedFetchAliases).toHaveBeenCalledWith('777002');
    expect(mockedDb.setBangumiAliasCache).toHaveBeenCalledWith(
      '777002',
      expect.objectContaining({
        aliases: ['Fresh Alias'],
        expiresAt: expect.any(Number),
      })
    );
  });

  it('still returns fetched aliases when persistent cache write fails', async () => {
    mockedDb.getBangumiAliasCache.mockRejectedValueOnce(new Error('offline'));
    mockedDb.setBangumiAliasCache.mockRejectedValueOnce(new Error('offline'));
    mockedFetchAliases.mockResolvedValueOnce(['Fallback Alias']);

    const response = await GET(requestFor('777003'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ aliases: ['Fallback Alias'] });
  });

  it('does not cache an empty result after a transient upstream failure', async () => {
    mockedDb.getBangumiAliasCache.mockResolvedValueOnce(null);
    mockedFetchAliases.mockRejectedValueOnce(new Error('temporary outage'));

    const response = await GET(requestFor('777004'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ aliases: [] });
    expect(response.headers).toEqual({ 'Cache-Control': 'no-store' });
    expect(mockedDb.setBangumiAliasCache).not.toHaveBeenCalled();
  });
});
