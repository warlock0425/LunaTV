import {
  clearSearchCacheForTests,
  getCachedSearchPage,
  setCachedSearchPage,
  stripCachedEpisodes,
} from './search-cache';
import type { SearchResult } from './types';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: '1',
    title: '測試',
    poster: '',
    episodes: ['https://cdn.example.test/1.m3u8'],
    episodes_titles: ['1'],
    source: 'src',
    source_name: '源',
    year: '2024',
    ...overrides,
  };
}

describe('search cache', () => {
  beforeEach(() => {
    clearSearchCacheForTests();
  });

  it('does not persist episode URLs in positive cache', () => {
    setCachedSearchPage('src', 'query', 1, 'ok', [result()], 3);
    const cached = getCachedSearchPage('src', 'query', 1);
    expect(cached?.status).toBe('ok');
    expect(cached?.pageCount).toBe(3);
    expect(cached?.data[0]?.episodes).toEqual([]);
    expect(cached?.data[0]?.episodes_titles).toEqual([]);
    expect(cached?.data[0]?.title).toBe('測試');
  });

  it('keeps timeout/forbidden entries out of the positive map', () => {
    setCachedSearchPage('src', 'query', 1, 'timeout', []);
    expect(getCachedSearchPage('src', 'query', 1)?.status).toBe('timeout');
    setCachedSearchPage('src', 'query', 1, 'ok', [result()]);
    expect(getCachedSearchPage('src', 'query', 1)?.status).toBe('ok');
  });

  it('stripCachedEpisodes copies metadata without play URLs', () => {
    expect(stripCachedEpisodes([result()])[0]).toMatchObject({
      id: '1',
      title: '測試',
      episodes: [],
      episodes_titles: [],
    });
  });
});
