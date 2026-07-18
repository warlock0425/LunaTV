/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

import { POST } from './route';

jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { setSkipConfig: jest.fn() } }));

const mockedAuth = jest.mocked(getAuthInfoFromCookie);
const mockedConfig = jest.mocked(getConfig);
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
    process.env.USERNAME = 'owner';
    mockedAuth.mockReturnValue({ username: 'owner' });
    mockedConfig.mockResolvedValue({ UserConfig: { Users: [] } } as never);
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
});
