/** @jest-environment node */

import { localizeSearchResult } from './downstream';
import { isFuzzyMatch } from './searchEngine';
import { SearchResult } from './types';

function cmsResult(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: '1',
    title: '机动战士高达',
    poster: '',
    episodes: [
      'https://cdn.example/路径/第01集.m3u8',
      'https://cdn.example/path/ep02.m3u8',
    ],
    episodes_titles: ['第01集', '第02集'],
    source: 'src',
    source_name: '測試源',
    year: '1979',
    desc: '这是简体简介缓存设置',
    ...overrides,
  };
}

describe('localizeSearchResult 顯示層繁體化', () => {
  it('只轉 title / desc，不碰 episodes URL', () => {
    const raw = cmsResult({});
    const localized = localizeSearchResult(raw);

    expect(localized.title).not.toBe(raw.title);
    // 簡體「这是」應被繁化
    expect(localized.desc).toContain('這是');
    expect(localized.desc).not.toContain('这是');

    expect(localized.episodes).toEqual(raw.episodes);
    expect(localized.episodes[0]).toContain('路径');
    expect(localized.episodes[0]).toContain('.m3u8');
  });

  it('繁化後標題仍能被台譯 isFuzzyMatch 接受（比對層契約）', () => {
    const raw = cmsResult({ title: '机动战士高达' });
    // 模擬 production：先用原始字串比對（downstream 內順序），再繁化
    expect(isFuzzyMatch(raw.title, '鋼彈')).toBe(true);

    const localized = localizeSearchResult(raw);
    // 客戶端搜尋頁再用繁化後標題過濾——必須仍過
    expect(isFuzzyMatch(localized.title, '鋼彈')).toBe(true);
  });

  it('episodes_titles 可保留（非 URL）；episodes 絕對不變', () => {
    const url = 'https://x.test/简体路径/play.m3u8?sign=1';
    const raw = cmsResult({
      episodes: [url],
      episodes_titles: ['第1集 特别篇'],
    });
    const localized = localizeSearchResult(raw);
    expect(localized.episodes[0]).toBe(url);
  });
});
