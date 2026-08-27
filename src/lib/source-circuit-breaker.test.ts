import { setRuntimeKvForTests } from './runtime-kv';
import {
  getTrippedSources,
  hydrateBreakersFromStore,
  isSourceInCooldown,
  isSourceTripped,
  recordSourceFailure,
  recordSourceSuccess,
  resetAllBreakers,
} from './source-circuit-breaker';

const COOLDOWN_MS = 10 * 60 * 1000; // 預設 10 分鐘

describe('source circuit breaker', () => {
  beforeEach(() => {
    resetAllBreakers();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    setRuntimeKvForTests(undefined);
  });

  it('is closed by default', () => {
    expect(isSourceTripped('src-a')).toBe(false);
  });

  it('trips only after consecutive failures reach the threshold', () => {
    recordSourceFailure('src-a');
    recordSourceFailure('src-a');
    expect(isSourceTripped('src-a')).toBe(false);

    recordSourceFailure('src-a');
    expect(isSourceTripped('src-a')).toBe(true);
  });

  it('resets the consecutive counter on success', () => {
    recordSourceFailure('src-a');
    recordSourceFailure('src-a');
    recordSourceSuccess('src-a');
    recordSourceFailure('src-a');
    recordSourceFailure('src-a');
    expect(isSourceTripped('src-a')).toBe(false);
  });

  it('keeps sources independent', () => {
    recordSourceFailure('src-a');
    recordSourceFailure('src-a');
    recordSourceFailure('src-a');
    expect(isSourceTripped('src-a')).toBe(true);
    expect(isSourceTripped('src-b')).toBe(false);
  });

  it('allows a single probe request after the cooldown', () => {
    for (let i = 0; i < 3; i++) recordSourceFailure('src-a');
    expect(isSourceTripped('src-a')).toBe(true);

    jest.advanceTimersByTime(COOLDOWN_MS + 1000);

    // 冷卻期滿：放行一個探測請求，其餘仍跳過
    expect(isSourceTripped('src-a')).toBe(false);
    expect(isSourceTripped('src-a')).toBe(true);
  });

  it('re-opens immediately when the probe fails', () => {
    for (let i = 0; i < 3; i++) recordSourceFailure('src-a');
    jest.advanceTimersByTime(COOLDOWN_MS + 1000);
    expect(isSourceTripped('src-a')).toBe(false); // 探測放行

    recordSourceFailure('src-a'); // 探測失敗
    expect(isSourceTripped('src-a')).toBe(true);
    // 且需要再等完整冷卻期
    jest.advanceTimersByTime(COOLDOWN_MS - 1000);
    expect(isSourceTripped('src-a')).toBe(true);
  });

  it('fully recovers when the probe succeeds', () => {
    for (let i = 0; i < 3; i++) recordSourceFailure('src-a');
    jest.advanceTimersByTime(COOLDOWN_MS + 1000);
    expect(isSourceTripped('src-a')).toBe(false); // 探測放行

    recordSourceSuccess('src-a');
    expect(isSourceTripped('src-a')).toBe(false);
    expect(isSourceTripped('src-a')).toBe(false);
  });

  it('lists tripped sources for observability', () => {
    for (let i = 0; i < 3; i++) recordSourceFailure('src-a');
    const tripped = getTrippedSources();
    expect(tripped).toHaveLength(1);
    expect(tripped[0].sourceKey).toBe('src-a');
    expect(tripped[0].consecutiveFailures).toBe(3);
  });

  it('hydrates tripped sources from the shared Kvrocks hash once', async () => {
    const openUntil = Date.now() + 60_000;
    const kv = {
      hGetAll: jest.fn(async () => ({
        'src-redis': JSON.stringify({
          consecutiveFailures: 3,
          openUntil,
        }),
      })),
      hSet: jest.fn(async () => undefined),
      hDel: jest.fn(async () => undefined),
      expire: jest.fn(async () => undefined),
      mGet: jest.fn(async () => []),
      set: jest.fn(async () => undefined),
      del: jest.fn(async () => undefined),
    };
    setRuntimeKvForTests(kv);

    await hydrateBreakersFromStore();
    expect(isSourceInCooldown('src-redis')).toBe(true);

    await hydrateBreakersFromStore();
    expect(kv.hGetAll).toHaveBeenCalledTimes(1);

    setRuntimeKvForTests(undefined);
  });

  it('isSourceInCooldown 純讀：冷卻中為 true，期滿後為 false 且不消耗探測名額', () => {
    for (let i = 0; i < 3; i++) recordSourceFailure('src-a');
    expect(isSourceInCooldown('src-a')).toBe(true);

    jest.advanceTimersByTime(COOLDOWN_MS + 1000);
    expect(isSourceInCooldown('src-a')).toBe(false);
    expect(isSourceInCooldown('src-a')).toBe(false); // 再讀仍不改 probing

    // 探測名額仍給 isSourceTripped
    expect(isSourceTripped('src-a')).toBe(false);
    expect(isSourceTripped('src-a')).toBe(true);
  });
});
