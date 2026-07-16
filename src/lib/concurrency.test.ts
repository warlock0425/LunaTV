import { createLinkedAbortController, mapWithConcurrency } from './concurrency';

describe('mapWithConcurrency', () => {
  it('limits active workers and preserves result order', async () => {
    let active = 0;
    let maxActive = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return value * 2;
    });

    expect(results).toEqual([2, 4, 6, 8]);
    expect(maxActive).toBe(2);
  });
});

describe('createLinkedAbortController', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('aborts when the parent aborts', () => {
    const parent = new AbortController();
    const linked = createLinkedAbortController(parent.signal, 1000);

    parent.abort();
    expect(linked.controller.signal.aborted).toBe(true);
    linked.cleanup();
  });

  it('aborts after the configured timeout', () => {
    const linked = createLinkedAbortController(undefined, 1000);

    jest.advanceTimersByTime(1000);
    expect(linked.controller.signal.aborted).toBe(true);
    linked.cleanup();
    expect(jest.getTimerCount()).toBe(0);
  });
});
