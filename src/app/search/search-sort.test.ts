/** @jest-environment node */

import {
  compareSearchTitleRelevance,
  compareSearchYears,
  getSearchScoreQueries,
  sortSearchItems,
} from './search-sort';

/**
 * 鎖住 search/page.tsx 實際 import 的比較器／排序器。
 *
 * 選題：純 localeCompare 會把「一一无关」排第一，只有評分能翻轉。
 * yearOrder === 'none' 時 compareSearchYears 回 0，整體順序仍須由分數決定。
 */
const UNRELATED_BUT_SORTS_FIRST = '一一无关';
const RELEVANT_GUNDAM = '机动战士高达';
const USER_QUERY = '鋼彈';

describe('search-sort（搜尋頁 production 比較器）', () => {
  it('getSearchScoreQueries 含台譯與 regional 陸名', () => {
    const queries = getSearchScoreQueries(USER_QUERY);
    expect(queries[0]).toBe(USER_QUERY);
    expect(queries.some((q) => q.includes('高达'))).toBe(true);
  });

  it('compareSearchYears：none 回 0；desc 時較新年份在前', () => {
    expect(compareSearchYears('2020', '2024', 'none')).toBe(0);
    expect(compareSearchYears('2020', '2024', 'desc')).toBeGreaterThan(0);
    expect(compareSearchYears('2024', '2020', 'desc')).toBeLessThan(0);
  });

  it('純字母序會把無關片排前——對照組', () => {
    const byLocale = [RELEVANT_GUNDAM, UNRELATED_BUT_SORTS_FIRST].sort((a, b) =>
      a.localeCompare(b)
    );
    expect(byLocale[0]).toBe(UNRELATED_BUT_SORTS_FIRST);
  });

  it('搜「鋼彈」時相關陸名必須靠評分翻轉字母序', () => {
    const scoreQueries = getSearchScoreQueries(USER_QUERY);
    const ranked = [UNRELATED_BUT_SORTS_FIRST, RELEVANT_GUNDAM].sort((a, b) =>
      compareSearchTitleRelevance(a, b, scoreQueries, 'asc')
    );
    expect(ranked[0]).toBe(RELEVANT_GUNDAM);
  });

  it('預設路徑 yearOrder=none 仍依相關性排序（不得提前 return）', () => {
    // 契約：none 時年份鍵為 0，順序只剩相關性——這是 page 預設行為
    expect(compareSearchYears('2010', '2024', 'none')).toBe(0);

    const ranked = sortSearchItems(
      [
        { title: UNRELATED_BUT_SORTS_FIRST, year: '2010' },
        { title: RELEVANT_GUNDAM, year: '2024' },
      ],
      USER_QUERY,
      'none'
    );
    expect(ranked[0].title).toBe(RELEVANT_GUNDAM);
  });

  it('yearOrder=desc 時年份優先於相關性', () => {
    const ranked = sortSearchItems(
      [
        { title: RELEVANT_GUNDAM, year: '2010' },
        { title: UNRELATED_BUT_SORTS_FIRST, year: '2024' },
      ],
      USER_QUERY,
      'desc'
    );
    expect(ranked[0].year).toBe('2024');
  });
});
