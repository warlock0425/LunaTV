/** @jest-environment node */

import { checkForUpdates, UpdateStatus } from './version_check';

describe('version check', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('aborts a response body that does not finish within the timeout', async () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      return {
        ok: true,
        text: () =>
          new Promise((_, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          }),
      } as Response;
    });

    const pendingStatus = checkForUpdates();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(5000);

    await expect(pendingStatus).resolves.toBe(UpdateStatus.FETCH_FAILED);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
