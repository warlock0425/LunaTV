import type { ApiSite } from './config';
import {
  isSourceTripped,
  recordSourceFailure,
  resetAllBreakers,
} from './source-circuit-breaker';
import {
  clearSourceHealthForTests,
  getSourceHealthSnapshots,
  orderSourcesByHealth,
  recordSourceSearch,
  resetSourceHealth,
} from './source-health';

const sites = [
  { key: 'slow', name: 'Slow', api: 'https://slow.test' },
  { key: 'fast', name: 'Fast', api: 'https://fast.test' },
] as ApiSite[];

const site = (key: string): ApiSite =>
  ({ key, name: key, api: `https://${key}.test` }) as ApiSite;

describe('source health ordering', () => {
  beforeEach(() => {
    clearSourceHealthForTests();
    resetAllBreakers();
  });

  it('moves measured faster sources ahead of slower sources', () => {
    recordSourceSearch('slow', 4000, false);
    recordSourceSearch('fast', 200, false);
    expect(orderSourcesByHealth(sites).map((site) => site.key)).toEqual([
      'fast',
      'slow',
    ]);
  });

  it('ranks measured-fast ahead of unknown, then slow', () => {
    const unknown = site('unknown');
    const measuredFast = site('fast');
    const measuredSlow = site('slow');
    recordSourceSearch('fast', 400, false);
    recordSourceSearch('slow', 4000, false);
    expect(
      orderSourcesByHealth([unknown, measuredSlow, measuredFast]).map(
        (item) => item.key
      )
    ).toEqual(['fast', 'unknown', 'slow']);
  });

  it('does not skip sources based on health timeouts; EWMA only', () => {
    for (let i = 0; i < 5; i++) recordSourceSearch('slow', 6000, true);
    recordSourceSearch('fast', 200, false);
    expect(orderSourcesByHealth(sites).map((item) => item.key)).toEqual([
      'fast',
      'slow',
    ]);
  });

  it('keeps one half-open source when every circuit is open', () => {
    for (const item of sites) {
      for (let i = 0; i < 3; i++) recordSourceFailure(item.key);
    }
    expect(orderSourcesByHealth(sites)).toHaveLength(1);
  });

  it('exposes snapshots and can reset one source', () => {
    recordSourceSearch('fast', 200, false);
    recordSourceSearch('slow', 4000, false);
    expect(getSourceHealthSnapshots().length).toBeGreaterThanOrEqual(2);
    resetSourceHealth('slow');
    expect(getSourceHealthSnapshots().every((s) => s.key !== 'slow')).toBe(
      true
    );
  });
});

/**
 * ③-A：排序必須認得 breaker 冷卻，且不得消耗半開探測名額。
 * 脫鉤 isSourceInCooldown 後，第 1 條會回到「死源排第一」。
 */
describe('orderSourcesByHealth × circuit breaker', () => {
  const COOLDOWN_MS = 10 * 60 * 1000;

  beforeEach(() => {
    clearSourceHealthForTests();
    resetAllBreakers();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-15T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('熔斷中的源不得排在健康源前面（即使 health 被污染成「很快」）', () => {
    const dead = site('dead');
    const good = site('good');
    for (let i = 0; i < 3; i++) recordSourceFailure('dead');
    // 模擬 search 路由對熔斷源記 ~1ms 且 timedOut=false 造成的污染
    recordSourceSearch('dead', 200, false);
    recordSourceSearch('good', 3000, false);

    expect(orderSourcesByHealth([dead, good]).map((s) => s.key)).toEqual([
      'good',
    ]);
  });

  it('全部熔斷時仍留一個候選，不能回空', () => {
    const deadA = site('deadA');
    const deadB = site('deadB');
    for (let i = 0; i < 3; i++) {
      recordSourceFailure('deadA');
      recordSourceFailure('deadB');
    }
    expect(orderSourcesByHealth([deadA, deadB])).toHaveLength(1);
  });

  it('半開探測名額不可被排序消耗', () => {
    const dead = site('dead');
    for (let i = 0; i < 3; i++) recordSourceFailure('dead');
    expect(isSourceTripped('dead')).toBe(true);

    jest.advanceTimersByTime(COOLDOWN_MS + 1000);

    // 排序純讀，不得吃掉 half-open 名額
    orderSourcesByHealth([dead]);
    expect(isSourceTripped('dead')).toBe(false); // 探測名額仍在
    expect(isSourceTripped('dead')).toBe(true); // 第二次才消耗
  });
});
