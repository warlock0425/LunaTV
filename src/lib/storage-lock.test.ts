describe('Redis-backed distributed storage locks', () => {
  afterEach(() => {
    jest.dontMock('redis');
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('renews ownership and makes release retry-safe for Redis and Kvrocks', async () => {
    const set = jest
      .fn()
      .mockResolvedValueOnce('OK')
      .mockResolvedValueOnce(null);
    const get = jest.fn().mockResolvedValue('owner-after-lost-response');
    const lostReleaseResponse = Object.assign(
      new Error('Connection reset after release'),
      { code: 'ECONNRESET' }
    );
    const evalCommand = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(lostReleaseResponse)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const client = {
      set,
      get,
      eval: evalCommand,
      connect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.doMock('redis', () => ({ createClient: jest.fn(() => client) }));

    const { BaseRedisStorage } =
      jest.requireActual<typeof import('./redis-base.db.js')>(
        './redis-base.db'
      );
    class TestRedisStorage extends BaseRedisStorage {
      constructor() {
        super(
          { url: 'redis://example.test:6379', clientName: 'TestRedis' },
          Symbol('test-redis-client')
        );
      }
    }
    const storage = new TestRedisStorage();

    await expect(
      storage.acquireLock('lock:key', 'owner', 30_000)
    ).resolves.toBe(true);
    expect(set).toHaveBeenNthCalledWith(1, 'lock:key', 'owner', {
      NX: true,
      PX: 30_000,
    });

    await expect(
      storage.acquireLock('lock:key', 'owner-after-lost-response', 30_000)
    ).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith('lock:key');

    await expect(storage.renewLock('lock:key', 'owner', 30_000)).resolves.toBe(
      true
    );
    expect(evalCommand).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("redis.call('PEXPIRE', KEYS[1], ARGV[2])"),
      { keys: ['lock:key'], arguments: ['owner', '30000'] }
    );

    jest.useFakeTimers();
    try {
      const releasePromise = storage.releaseLock('lock:key', 'owner');
      const releaseExpectation = expect(releasePromise).resolves.toBe(true);
      await jest.advanceTimersByTimeAsync(1_000);
      await releaseExpectation;
    } finally {
      jest.useRealTimers();
    }
    await expect(storage.releaseLock('lock:key', 'other')).resolves.toBe(false);
    expect(evalCommand).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("redis.call('GET', KEYS[1]) == ARGV[1]"),
      {
        keys: ['lock:key', 'lock:key:released:owner'],
        arguments: ['owner', '60000'],
      }
    );
    expect(evalCommand).toHaveBeenNthCalledWith(3, expect.any(String), {
      keys: ['lock:key', 'lock:key:released:owner'],
      arguments: ['owner', '60000'],
    });
    expect(evalCommand.mock.calls[1][0]).toContain(
      "redis.call('DEL', KEYS[1])"
    );
    expect(evalCommand.mock.calls[1][0]).toContain(
      "redis.call('GET', KEYS[2]) == ARGV[1]"
    );
  });
});

describe('Upstash distributed storage locks', () => {
  const globalKey = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');
  const originalUrl = process.env.UPSTASH_URL;
  const originalToken = process.env.UPSTASH_TOKEN;

  afterEach(() => {
    delete (globalThis as { [key: symbol]: unknown })[globalKey];
    if (originalUrl === undefined) delete process.env.UPSTASH_URL;
    else process.env.UPSTASH_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_TOKEN;
    else process.env.UPSTASH_TOKEN = originalToken;
    jest.dontMock('@upstash/redis');
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('uses compare-token renewal and retry-safe release', async () => {
    delete (globalThis as { [key: symbol]: unknown })[globalKey];
    process.env.UPSTASH_URL = 'https://example.upstash.io';
    process.env.UPSTASH_TOKEN = 'token';
    const set = jest.fn().mockResolvedValue('OK');
    const evalCommand = jest
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const client = {
      set,
      get: jest.fn(),
      eval: evalCommand,
    };
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.doMock('@upstash/redis', () => ({
      Redis: jest.fn(() => client),
    }));

    const { UpstashRedisStorage } =
      jest.requireActual<typeof import('./upstash.db.js')>('./upstash.db');
    const storage = new UpstashRedisStorage();

    await expect(
      storage.acquireLock('lock:key', 'owner', 30_000)
    ).resolves.toBe(true);
    expect(set).toHaveBeenCalledWith('lock:key', 'owner', {
      nx: true,
      px: 30_000,
    });

    await expect(storage.renewLock('lock:key', 'owner', 30_000)).resolves.toBe(
      true
    );
    expect(evalCommand).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("redis.call('PEXPIRE', KEYS[1], ARGV[2])"),
      ['lock:key'],
      ['owner', '30000']
    );

    await expect(storage.releaseLock('lock:key', 'owner')).resolves.toBe(true);
    expect(evalCommand).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("redis.call('GET', KEYS[1]) == ARGV[1]"),
      ['lock:key', 'lock:key:released:owner'],
      ['owner', '60000']
    );
    expect(evalCommand.mock.calls[1][0]).toContain(
      "redis.call('DEL', KEYS[1])"
    );
    expect(evalCommand.mock.calls[1][0]).toContain(
      "redis.call('GET', KEYS[2]) == ARGV[1]"
    );
  });
});
