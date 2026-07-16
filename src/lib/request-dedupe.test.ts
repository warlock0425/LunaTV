import { deduplicateRequest, getActiveRequestCount } from './request-dedupe';

describe('deduplicateRequest', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shares an in-flight request and clears its timeout after success', async () => {
    let resolveRequest: (value: string) => void = () => undefined;
    const factory = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRequest = resolve;
        })
    );

    const first = deduplicateRequest('same-key', factory, 1000);
    const second = deduplicateRequest('same-key', factory, 1000);

    expect(second).toBe(first);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(getActiveRequestCount()).toBe(1);

    resolveRequest('ok');
    await expect(first).resolves.toBe('ok');

    expect(getActiveRequestCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('releases the request entry after a timeout', async () => {
    const request = deduplicateRequest(
      'timeout-key',
      () => new Promise<string>(() => undefined),
      100
    );

    jest.advanceTimersByTime(100);
    await expect(request).rejects.toThrow(
      'deduplicateRequest timeout: timeout-key'
    );

    expect(getActiveRequestCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});
