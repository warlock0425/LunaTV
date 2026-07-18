import { storage } from '@/lib/storage';

import { POST } from './route';

jest.mock('@/lib/storage', () => ({
  storage: { hgetall: jest.fn(), hdel: jest.fn() },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      ({ status: init?.status || 200, json: async () => body }) as Response,
  },
}));

const mockedStorage = storage as jest.Mocked<typeof storage>;

function requestFor(body: Record<string, unknown>) {
  return {
    json: async () => body,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'cookie'
          ? `auth=${encodeURIComponent(JSON.stringify({ username: 'alice' }))}`
          : null,
    },
  } as never;
}

describe('/api/history/delete', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a title that becomes empty after normalization', async () => {
    const response = await POST(requestFor({ vod_name: '!!!' }));

    expect(response.status).toBe(400);
    expect(mockedStorage.hgetall).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed JSON body', async () => {
    const response = await POST({
      json: async () => {
        throw new SyntaxError('invalid json');
      },
    } as never);

    expect(response.status).toBe(400);
    expect(mockedStorage.hgetall).not.toHaveBeenCalled();
  });

  it('only deletes an exact normalized title match', async () => {
    mockedStorage.hgetall.mockResolvedValue({
      exact: JSON.stringify({ title: '一', source: 'A' }),
      contains: JSON.stringify({ title: '一生一世', source: 'A' }),
      otherSource: JSON.stringify({ title: '一', source: 'B' }),
    });

    const response = await POST(
      requestFor({ vod_name: '一', source_name: 'A' })
    );

    expect(response.status).toBe(200);
    expect(mockedStorage.hdel).toHaveBeenCalledTimes(1);
    expect(mockedStorage.hdel).toHaveBeenCalledWith(
      'user:history:alice',
      'exact'
    );
  });

  it('does not delete a legacy record without a source when a source is specified', async () => {
    mockedStorage.hgetall.mockResolvedValue({
      exact: JSON.stringify({ title: '一', source: 'A' }),
      legacy: JSON.stringify({ title: '一' }),
    });

    const response = await POST(
      requestFor({ vod_name: '一', source_name: 'A' })
    );

    expect(response.status).toBe(200);
    expect(mockedStorage.hdel).toHaveBeenCalledTimes(1);
    expect(mockedStorage.hdel).toHaveBeenCalledWith(
      'user:history:alice',
      'exact'
    );
  });
});
