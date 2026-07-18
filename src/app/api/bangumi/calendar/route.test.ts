/** @jest-environment node */

import { GET } from './route';

describe('GET /api/bangumi/calendar', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps the timeout active while parsing the upstream response body', async () => {
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      return {
        ok: true,
        json: () =>
          new Promise((_, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          }),
      } as Response;
    });

    const pendingResponse = GET();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(10000);

    const response = await pendingResponse;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });
});
