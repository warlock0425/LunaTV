/** @jest-environment node */

import {
  getOutboundGateActiveForTests,
  resetOutboundGateForTests,
  withOutboundSlot,
} from './outbound-gate';

describe('outbound gate', () => {
  const originalCap = process.env.SEARCH_OUTBOUND_CAP;

  beforeEach(() => {
    resetOutboundGateForTests();
    process.env.SEARCH_OUTBOUND_CAP = '2';
  });

  afterEach(() => {
    process.env.SEARCH_OUTBOUND_CAP = originalCap;
    resetOutboundGateForTests();
  });

  it('limits concurrent outbound work to the configured cap', async () => {
    let current = 0;
    let max = 0;
    const started: Array<() => void> = [];

    const run = () =>
      withOutboundSlot(async () => {
        current += 1;
        max = Math.max(max, current);
        await new Promise<void>((resolve) => started.push(resolve));
        current -= 1;
      });

    const first = run();
    const second = run();
    const third = run();

    await Promise.resolve();
    await Promise.resolve();
    expect(getOutboundGateActiveForTests()).toBe(2);
    expect(started).toHaveLength(2);

    started[0]();
    started[1]();
    await Promise.all([first, second]);
    await Promise.resolve();
    await Promise.resolve();
    started[2]();
    await third;

    expect(max).toBe(2);
  });

  it('rejects waiters when the signal aborts', async () => {
    let releaseHold!: () => void;
    const holdWork = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const hold = withOutboundSlot(() => holdWork);
    const hold2 = withOutboundSlot(() => holdWork);
    await Promise.resolve();
    await Promise.resolve();
    expect(getOutboundGateActiveForTests()).toBe(2);

    const controller = new AbortController();
    const pending = withOutboundSlot(async () => 'nope', controller.signal);
    await Promise.resolve();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    releaseHold();
    await Promise.all([hold, hold2]);
  });
});
