import {
  getCachedBangumiAliases,
  setCachedBangumiAliases,
  warmBangumiAliases,
} from './bangumi-alias-cache';

function mockAliasResponse(aliases: string[], delayMs = 0): Promise<Response> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        ok: true,
        json: async () => ({ aliases }),
      } as Response);
    }, delayMs);
  });
}

describe('bangumi-alias-cache', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  it('returns null on cache miss', () => {
    expect(getCachedBangumiAliases(100001)).toBeNull();
  });

  it('stores cleaned aliases and returns a defensive copy', () => {
    setCachedBangumiAliases(100002, [' Alpha ', '', 'Beta', 'Alpha']);

    const cached = getCachedBangumiAliases(100002);
    expect(cached).toEqual(['Alpha', 'Beta']);

    cached?.push('mutated');
    expect(getCachedBangumiAliases(100002)).toEqual(['Alpha', 'Beta']);
  });

  it('expires cached aliases after ttl', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1000);
    setCachedBangumiAliases(100003, ['Alias'], 500);

    nowSpy.mockReturnValue(1499);
    expect(getCachedBangumiAliases(100003)).toEqual(['Alias']);

    nowSpy.mockReturnValue(1500);
    expect(getCachedBangumiAliases(100003)).toBeNull();
  });

  it('warms aliases from the Bangumi aliases API', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ aliases: [' Alias ', '', 'Alias', 'Other'] }),
    } as Response);

    await warmBangumiAliases(100004);

    expect(fetchSpy).toHaveBeenCalledWith('/api/bangumi/aliases?id=100004', {
      signal: expect.any(AbortSignal),
    });
    expect(getCachedBangumiAliases(100004)).toEqual(['Alias', 'Other']);
  });

  it('does not throw when warming fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));

    await expect(warmBangumiAliases(100005)).resolves.toBeUndefined();
    expect(getCachedBangumiAliases(100005)).toBeNull();
  });

  it('deduplicates concurrent warm requests for the same bgmId', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => mockAliasResponse(['Shared'], 10));

    await Promise.all([
      warmBangumiAliases(100006),
      warmBangumiAliases(100006),
      warmBangumiAliases(100006),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(getCachedBangumiAliases(100006)).toEqual(['Shared']);
  });

  it('returns quickly for fire-and-forget trigger calls', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => mockAliasResponse(['Later'], 50));

    const promise = warmBangumiAliases(100007);
    expect(promise).toBeInstanceOf(Promise);
    expect(getCachedBangumiAliases(100007)).toBeNull();

    await promise;
    expect(getCachedBangumiAliases(100007)).toEqual(['Later']);
  });

  it('aborts a stalled warm request and releases its in-flight entry', async () => {
    jest.useFakeTimers();
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((_url, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });

    const first = warmBangumiAliases(100008);
    const duplicate = warmBangumiAliases(100008);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(10000);
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(getCachedBangumiAliases(100008)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);

    jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ aliases: ['Recovered'] }),
    } as Response);
    await warmBangumiAliases(100008);
    expect(getCachedBangumiAliases(100008)).toEqual(['Recovered']);
  });
});
