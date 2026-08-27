import type { ApiSite } from './config';
import { searchFromApi } from './downstream';
import { fanoutSearchSources } from './search-fanout';
import { resetAllBreakers } from './source-circuit-breaker';
import { clearSourceHealthForTests } from './source-health';
import type { SearchResult } from './types';

jest.mock('./downstream', () => ({
  searchFromApi: jest.fn(),
}));

const mockedSearchFromApi = searchFromApi as jest.MockedFunction<
  typeof searchFromApi
>;

const site = (key: string): ApiSite =>
  ({ key, name: key, api: `https://${key}.test` }) as ApiSite;

function hit(source: string): SearchResult {
  return {
    id: '1',
    title: source,
    poster: '',
    episodes: [],
    episodes_titles: [],
    source,
    source_name: source,
    year: '2024',
  };
}

describe('fanoutSearchSources', () => {
  const originalEnv = {
    SEARCH_SOURCE_CONCURRENCY: process.env.SEARCH_SOURCE_CONCURRENCY,
    SEARCH_SUCCESS_SOURCE_CUTOFF: process.env.SEARCH_SUCCESS_SOURCE_CUTOFF,
    SEARCH_DEADLINE_MS: process.env.SEARCH_DEADLINE_MS,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetAllBreakers();
    clearSourceHealthForTests();
    process.env.SEARCH_SOURCE_CONCURRENCY = '2';
    process.env.SEARCH_SUCCESS_SOURCE_CUTOFF = '2';
    process.env.SEARCH_DEADLINE_MS = '8000';
  });

  afterEach(() => {
    process.env.SEARCH_SOURCE_CONCURRENCY =
      originalEnv.SEARCH_SOURCE_CONCURRENCY;
    process.env.SEARCH_SUCCESS_SOURCE_CUTOFF =
      originalEnv.SEARCH_SUCCESS_SOURCE_CUTOFF;
    process.env.SEARCH_DEADLINE_MS = originalEnv.SEARCH_DEADLINE_MS;
  });

  it('stops starting new sources after the success cutoff', async () => {
    mockedSearchFromApi.mockImplementation(async (apiSite) => [
      hit(apiSite.key),
    ]);

    const results = await fanoutSearchSources({
      sites: [site('a'), site('b'), site('c'), site('d')],
      query: 'cutoff-probe',
      variants: ['cutoff-probe'],
    });

    const searched = results.filter((entry) => !entry.skipped);
    expect(mockedSearchFromApi.mock.calls.length).toBeLessThanOrEqual(4);
    expect(searched.length).toBeGreaterThanOrEqual(2);
    expect(results.some((entry) => entry.skipped)).toBe(true);
  });

  it('emits onSiteResult only for sources that actually ran', async () => {
    const seen: string[] = [];
    mockedSearchFromApi.mockImplementation(async (apiSite) => [
      hit(apiSite.key),
    ]);

    await fanoutSearchSources({
      sites: [site('a'), site('b'), site('c')],
      query: 'progress-probe',
      variants: ['progress-probe'],
      onSiteResult: (entry) => {
        seen.push(entry.site.key);
      },
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBe(new Set(seen).size);
  });
});
