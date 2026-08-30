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

  it('keeps the full episode list in positive cache', () => {
    setCachedSearchPage(
      'src',
      'query',
      1,
      'ok',
      [
        result({
          episodes: [
            'https://cdn.example.test/1.m3u8',
            'https://cdn.example.test/2.m3u8',
            'https://cdn.example.test/3.m3u8',
          ],
          episodes_titles: ['1', '2', '3'],
          episode_count: 3,
        }),
      ],
      3
    );
    const cached = getCachedSearchPage('src', 'query', 1);
    expect(cached?.status).toBe('ok');
    expect(cached?.pageCount).toBe(3);
    expect(cached?.data[0]?.episodes).toEqual([
      'https://cdn.example.test/1.m3u8',
      'https://cdn.example.test/2.m3u8',
      'https://cdn.example.test/3.m3u8',
    ]);
    expect(cached?.data[0]?.episodes_titles).toEqual(['1', '2', '3']);
    expect(cached?.data[0]?.episode_count).toBe(3);
    expect(cached?.data[0]?.title).toBe('測試');
  });

  it('keeps timeout/forbidden entries out of the positive map', () => {
    setCachedSearchPage('src', 'query', 1, 'timeout', []);
    expect(getCachedSearchPage('src', 'query', 1)?.status).toBe('timeout');
    setCachedSearchPage('src', 'query', 1, 'ok', [result()]);
    expect(getCachedSearchPage('src', 'query', 1)?.status).toBe('ok');
  });

  it('stripCachedEpisodes keeps the full list and fills episode_count', () => {
    expect(
      stripCachedEpisodes([
        result({
          episodes: [
            'https://cdn.example.test/1.m3u8',
            'https://cdn.example.test/2.m3u8',
          ],
          episodes_titles: ['1', '2'],
          episode_count: 24,
        }),
      ])[0]
    ).toMatchObject({
      id: '1',
      title: '測試',
      episodes: [
        'https://cdn.example.test/1.m3u8',
        'https://cdn.example.test/2.m3u8',
      ],
      episodes_titles: ['1', '2'],
      episode_count: 24,
    });
  });
});
