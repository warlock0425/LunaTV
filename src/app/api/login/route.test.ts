/** @jest-environment node */

import { NextRequest } from 'next/server';

import { clearLoginAttempts, consumeLoginAttempt } from '@/lib/security-store';

import { POST } from './route';

jest.mock('@/lib/config', () => ({ getFreshConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({ db: { verifyUser: jest.fn() } }));
jest.mock('@/lib/storage-runtime', () => ({
  getServerStorageType: () => 'redis',
}));
jest.mock('@/lib/security-store', () => ({
  clearLoginAttempts: jest.fn(),
  consumeLoginAttempt: jest.fn(),
  getSessionVersion: jest.fn(),
}));

const mockedConsume = jest.mocked(consumeLoginAttempt);
const mockedClear = jest.mocked(clearLoginAttempts);

describe('login API rate limiting', () => {
  const originalTrustProxy = process.env.TRUST_PROXY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USERNAME = 'owner';
    process.env.PASSWORD = 'correct-password';
    mockedConsume.mockResolvedValue({ blocked: false, retryAfter: 0 });
    mockedClear.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
  });

  it('limits both the forwarded IP and the account identity', async () => {
    process.env.TRUST_PROXY = 'true';
    const response = await POST(
      new NextRequest('http://localhost/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.8',
        },
        body: JSON.stringify({
          username: 'owner',
          password: 'wrong-password',
        }),
      })
    );

    expect(response.status).toBe(401);
    expect(mockedConsume).toHaveBeenCalledWith('login:ip:203.0.113.8', 5, 900);
    expect(mockedConsume).toHaveBeenCalledWith('login:user:owner', 5, 900);
  });

  it('does not trust X-Forwarded-For unless TRUST_PROXY is set', async () => {
    delete process.env.TRUST_PROXY;
    const response = await POST(
      new NextRequest('http://localhost/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.8',
        },
        body: JSON.stringify({
          username: 'owner',
          password: 'wrong-password',
        }),
      })
    );

    expect(response.status).toBe(401);
    expect(mockedConsume).not.toHaveBeenCalledWith(
      'login:ip:203.0.113.8',
      5,
      900
    );
    expect(mockedConsume).toHaveBeenCalledWith('login:user:owner', 5, 900);
    expect(mockedConsume).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for malformed JSON without consuming an attempt', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })
    );

    expect(response.status).toBe(400);
    expect(mockedConsume).not.toHaveBeenCalled();
  });
});
