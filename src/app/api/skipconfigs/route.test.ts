/** @jest-environment node */

import { NextRequest } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

import { POST } from './route';

jest.mock('@/lib/api-auth', () => ({ requireActiveUser: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { setSkipConfig: jest.fn() } }));

const mockedAuth = jest.mocked(requireActiveUser);
const mockedDb = db as unknown as { setSkipConfig: jest.Mock };

function requestFor(outroTime: number) {
  return new NextRequest('http://localhost/api/skipconfigs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: 'demo+episode-1',
      config: { enable: true, intro_time: 10, outro_time: outroTime },
    }),
  });
}

describe('skip config API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockResolvedValue({
      username: 'owner',
      auth: { username: 'owner' },
    } as Awaited<ReturnType<typeof requireActiveUser>>);
  });

  it('accepts the negative end-relative time produced by the player', async () => {
    const response = await POST(requestFor(-100));

    expect(response.status).toBe(200);
    expect(mockedDb.setSkipConfig).toHaveBeenCalledWith(
      'owner',
      'demo',
      'episode-1',
      { enable: true, intro_time: 10, outro_time: -100 }
    );
  });

  it('rejects a positive outro time that the player cannot apply', async () => {
    const response = await POST(requestFor(100));

    expect(response.status).toBe(400);
    expect(mockedDb.setSkipConfig).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON instead of an internal error', async () => {
    const request = new NextRequest('http://localhost/api/skipconfigs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mockedDb.setSkipConfig).not.toHaveBeenCalled();
  });

  it('returns 401 when the session is not verified', async () => {
    mockedAuth.mockResolvedValue(null);
    const response = await POST(requestFor(-100));
    expect(response.status).toBe(401);
    expect(mockedDb.setSkipConfig).not.toHaveBeenCalled();
  });
});
