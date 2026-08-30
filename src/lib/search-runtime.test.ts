import {
  getSearchDeadlineMs,
  getSearchOutboundCap,
  getSearchSourceConcurrency,
  getSearchSuccessSourceCutoff,
} from './search-runtime';

describe('search runtime env', () => {
  const originalEnv = {
    SEARCH_SOURCE_CONCURRENCY: process.env.SEARCH_SOURCE_CONCURRENCY,
    SEARCH_OUTBOUND_CAP: process.env.SEARCH_OUTBOUND_CAP,
    SEARCH_SUCCESS_SOURCE_CUTOFF: process.env.SEARCH_SUCCESS_SOURCE_CUTOFF,
    SEARCH_DEADLINE_MS: process.env.SEARCH_DEADLINE_MS,
  };

  afterEach(() => {
    process.env.SEARCH_SOURCE_CONCURRENCY =
      originalEnv.SEARCH_SOURCE_CONCURRENCY;
    process.env.SEARCH_OUTBOUND_CAP = originalEnv.SEARCH_OUTBOUND_CAP;
    process.env.SEARCH_SUCCESS_SOURCE_CUTOFF =
      originalEnv.SEARCH_SUCCESS_SOURCE_CUTOFF;
    process.env.SEARCH_DEADLINE_MS = originalEnv.SEARCH_DEADLINE_MS;
  });

  it('clamps concurrency to 1–24 and outbound cap to 1–64', () => {
    process.env.SEARCH_SOURCE_CONCURRENCY = '99';
    process.env.SEARCH_OUTBOUND_CAP = '0';
    expect(getSearchSourceConcurrency()).toBe(24);
    expect(getSearchOutboundCap()).toBe(1);
  });

  it('uses completeness-first defaults', () => {
    delete process.env.SEARCH_SOURCE_CONCURRENCY;
    delete process.env.SEARCH_OUTBOUND_CAP;
    delete process.env.SEARCH_SUCCESS_SOURCE_CUTOFF;
    delete process.env.SEARCH_DEADLINE_MS;
    expect(getSearchSourceConcurrency()).toBe(12);
    expect(getSearchOutboundCap()).toBe(32);
    expect(getSearchSuccessSourceCutoff()).toBe(64);
    expect(getSearchDeadlineMs()).toBe(20000);
  });
});
