import {
  clearLoginAttempts,
  consumeLoginAttempt,
  getSessionVersion,
  revokeUserSessions,
} from './security-store';

describe('security store memory fallback', () => {
  it('increments the session version when sessions are revoked', async () => {
    const username = `session-${Date.now()}-${Math.random()}`;
    expect(await getSessionVersion(username)).toBe(1);
    expect(await revokeUserSessions(username)).toBe(2);
    expect(await getSessionVersion(username)).toBe(2);
  });

  it('starts a direct revocation above the default cookie version', async () => {
    const username = `direct-revoke-${Date.now()}-${Math.random()}`;
    expect(await revokeUserSessions(username)).toBe(2);
  });

  it('limits attempts within a window and can clear them', async () => {
    const identity = `login-${Date.now()}-${Math.random()}`;
    expect((await consumeLoginAttempt(identity, 2, 60)).blocked).toBe(false);
    expect((await consumeLoginAttempt(identity, 2, 60)).blocked).toBe(false);
    expect((await consumeLoginAttempt(identity, 2, 60)).blocked).toBe(true);

    await clearLoginAttempts(identity);
    expect((await consumeLoginAttempt(identity, 2, 60)).blocked).toBe(false);
  });
});

describe('security store Redis backend', () => {
  const originalStorageType = process.env.STORAGE_TYPE;
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    if (originalStorageType === undefined) delete process.env.STORAGE_TYPE;
    else process.env.STORAGE_TYPE = originalStorageType;
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    jest.dontMock('redis');
    jest.resetModules();
  });

  it('listens for client errors and atomically increments with a repaired TTL', async () => {
    const on = jest.fn();
    const connect = jest.fn().mockResolvedValue(undefined);
    const evalCommand = jest
      .fn()
      .mockResolvedValueOnce([1, 60])
      .mockResolvedValueOnce([6, 45]);
    const incr = jest.fn();
    const expire = jest.fn();
    const ttl = jest.fn();

    jest.resetModules();
    jest.doMock('redis', () => ({
      createClient: jest.fn(() => ({
        on,
        connect,
        eval: evalCommand,
        incr,
        expire,
        ttl,
      })),
    }));
    process.env.STORAGE_TYPE = 'redis';
    process.env.REDIS_URL = 'redis://example.test:6379';

    const redisSecurityStore =
      jest.requireActual<typeof import('./security-store.js')>(
        './security-store'
      );

    await expect(
      redisSecurityStore.consumeLoginAttempt('client', 5, 60)
    ).resolves.toEqual({ blocked: false, retryAfter: 60 });
    await expect(
      redisSecurityStore.consumeLoginAttempt('client', 5, 60)
    ).resolves.toEqual({ blocked: true, retryAfter: 45 });

    expect(on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(evalCommand).toHaveBeenCalledTimes(2);
    expect(evalCommand).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('TTL', KEYS[1])"),
      {
        keys: ['security:login:client'],
        arguments: ['60'],
      }
    );
    expect(evalCommand.mock.calls[0][0]).toContain(
      "redis.call('EXPIRE', KEYS[1], ARGV[1])"
    );
    expect(incr).not.toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
    expect(ttl).not.toHaveBeenCalled();
  });
});
