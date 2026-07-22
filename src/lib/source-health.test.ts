import type { ApiSite } from './config';
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

describe('source health ordering', () => {
  beforeEach(clearSourceHealthForTests);

  it('moves measured faster sources ahead of slower sources', () => {
    recordSourceSearch('slow', 4000, false);
    recordSourceSearch('fast', 200, false);
    expect(orderSourcesByHealth(sites).map((site) => site.key)).toEqual([
      'fast',
      'slow',
    ]);
  });

  it('opens a circuit after repeated timeouts', () => {
    for (let i = 0; i < 3; i++) recordSourceSearch('slow', 6000, true);
    expect(orderSourcesByHealth(sites).map((site) => site.key)).toEqual([
      'fast',
    ]);
  });

  it('keeps one half-open source when every circuit is open', () => {
    for (const site of sites) {
      for (let i = 0; i < 3; i++) recordSourceSearch(site.key, 6000, true);
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
