/** @jest-environment node */

import { localizeSearchResult } from './downstream';
import { SearchResult } from './types';

/**
 * 契約：搜尋／詳情結果不得改寫 CMS 片名與簡介。
 * 繁簡／台譯只負責查詢與比對，顯示層保持上游原文。
 */
function cmsResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: '1',
    title: '机动战士高达',
    poster: '',
    episodes: ['https://cdn.example/路径/第01集.m3u8'],
    episodes_titles: ['第01集'],
    source: 'src',
    source_name: '測試源',
    year: '1979',
    desc: '这是简体简介',
    type_name: '动漫',
    ...overrides,
  };
}

describe('localizeSearchResult 保留 CMS 原文', () => {
  it('不改 title / desc / type_name / episodes', () => {
    const raw = cmsResult();
    const out = localizeSearchResult(raw);

    expect(out.title).toBe(raw.title);
    expect(out.desc).toBe(raw.desc);
    expect(out.type_name).toBe(raw.type_name);
    expect(out.episodes).toEqual(raw.episodes);
    expect(out.episodes[0]).toContain('路径');
  });

  it('回傳同一語意物件（不轉繁）', () => {
    const raw = cmsResult({ title: '进击的巨人', desc: '缓存设置' });
    const out = localizeSearchResult(raw);
    expect(out.title).toBe('进击的巨人');
    expect(out.desc).toBe('缓存设置');
  });
});
