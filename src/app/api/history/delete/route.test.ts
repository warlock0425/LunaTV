import { requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

import { POST } from './route';

jest.mock('@/lib/api-auth', () => ({ requireActiveUser: jest.fn() }));
jest.mock('@/lib/db', () => ({
  db: { deletePlayRecordsByTitle: jest.fn() },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      ({ status: init?.status || 200, json: async () => body }) as Response,
  },
}));

const mockedDelete = jest.mocked(db.deletePlayRecordsByTitle);
const mockedAuth = jest.mocked(requireActiveUser);

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockResolvedValue({
      username: 'alice',
      auth: { username: 'alice' },
    } as Awaited<ReturnType<typeof requireActiveUser>>);
  });

  it('rejects a title that becomes empty after normalization', async () => {
    const response = await POST(requestFor({ vod_name: '!!!' }));

    expect(response.status).toBe(400);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed JSON body', async () => {
    const response = await POST({
      json: async () => {
        throw new SyntaxError('invalid json');
      },
    } as never);

    expect(response.status).toBe(400);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('deletes by title under the play-record lock', async () => {
    mockedDelete.mockResolvedValue(1);

    const response = await POST(
      requestFor({ vod_name: '一', source_name: 'A' })
    );

    expect(response.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalledWith('alice', '一', 'A');
  });
});
