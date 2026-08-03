/** @jest-environment node */

import {
  compareSearchTitleRelevance,
  compareSearchYears,
  getSearchScoreQueries,
} from './search-sort';

/**
 * 鎖住 search/page.tsx 實際 import 的比較器（非測試內重寫的假比較器）。
 *
 * 選題要求：純 localeCompare 會把無關片排前面，只有評分能翻轉順序。
 * 「一一无关」在 localeCompare 上早於「机动战士高达」，
 * 但搜「鋼彈」時後者分數應更高。若把 scoreDiff 改成常數 0，本檔必須紅。
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

  it('compareSearchYears：desc 時較新年份在前', () => {
    expect(compareSearchYears('2020', '2024', 'desc')).toBeGreaterThan(0);
    expect(compareSearchYears('2024', '2020', 'desc')).toBeLessThan(0);
    expect(compareSearchYears('2020', '2024', 'none')).toBe(0);
  });

  it('純字母序會把無關片排前——對照組（證明選題有效）', () => {
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

  it('使用者台譯與 CMS 陸名不同字串時仍能排對', () => {
    // 用變數避免 TS2367（字面常數相比被判定恆真／恆假）
    const cmsTitle: string = RELEVANT_GUNDAM;
    const query: string = USER_QUERY;
    expect(cmsTitle === query).toBe(false);

    const scoreQueries = getSearchScoreQueries(query);
    const ranked = [UNRELATED_BUT_SORTS_FIRST, cmsTitle].sort((a, b) =>
      compareSearchTitleRelevance(a, b, scoreQueries, 'asc')
    );
    expect(ranked[0]).toBe(cmsTitle);
  });
});
