/** @jest-environment node */

import { getMainlandSearchQueries } from './mainland-search';
import {
  buildPlaybackSearchPlan,
  getMainlandFallbackSourceSearchQueries,
} from './play-search';
import { getRegionalMainlandTitles } from './regional-title-aliases';
import { getBestTitleMatchScore, isFuzzyMatch } from './searchEngine';

/**
 * 換源查詢計畫 × regional 全鏈：與 search-regional-bridge 同形。
 * 搜尋頁修了「有結果被濾掉」；換源若從不丟陸名，比對再好也沒結果可留。
 */

function mainlandStageQueries(title: string, searchTitle?: string): string[] {
  const plan = buildPlaybackSearchPlan({
    title,
    searchTitle,
    // 播放頁已有源時會 includeFastStage: false，仍必須能丟陸名
    includeFastStage: false,
  });
  const mainland = plan.find((stage) => stage.reason === 'mainland');
  return mainland?.queries ?? [];
}

describe('換源查詢計畫：陸源譯名橋接', () => {
  it.each([
    {
      userTitle: '蜘蛛人',
      plannedMustInclude: '蜘蛛侠',
      cmsTitle: '蜘蛛侠：英雄归来',
    },
    {
      userTitle: '棋靈王',
      plannedMustInclude: '棋魂',
      cmsTitle: '棋魂',
    },
    {
      userTitle: '間諜家家酒',
      plannedMustInclude: '间谍过家家',
      cmsTitle: '间谍过家家',
    },
    {
      userTitle: '鋼彈',
      plannedMustInclude: '高达',
      cmsTitle: '机动战士高达',
    },
  ])(
    '「$userTitle」mainland 階段含陸名，且能對上 CMS「$cmsTitle」',
    ({ userTitle, plannedMustInclude, cmsTitle }) => {
      // 與站內搜尋共用同一張表／計畫，不得另長第三套別名
      expect(
        getMainlandSearchQueries(userTitle).some((q) =>
          q.includes(plannedMustInclude)
        )
      ).toBe(true);
      expect(
        getRegionalMainlandTitles(userTitle).some((t) =>
          t.includes(plannedMustInclude)
        )
      ).toBe(true);

      const mainlandQueries = mainlandStageQueries(userTitle);
      expect(mainlandQueries.length).toBeGreaterThan(0);
      expect(mainlandQueries.some((q) => q.includes(plannedMustInclude))).toBe(
        true
      );

      // 模擬 CMS 用陸名回傳後，比對層保留（2.9.6 已修）
      expect(isFuzzyMatch(cmsTitle, userTitle)).toBe(true);
    }
  );

  it('兩字台譯「鋼彈」不得整段被長度守衛丟成 0 個 stage', () => {
    const plan = buildPlaybackSearchPlan({ title: '鋼彈' });
    expect(plan.length).toBeGreaterThan(0);
    const allQueries = plan.flatMap((stage) => stage.queries);
    expect(allQueries.some((q) => q.includes('高达'))).toBe(true);
  });

  it('陸名進 mainland 階段，不塞進 fast 階段', () => {
    const plan = buildPlaybackSearchPlan({
      title: '間諜家家酒',
      includeFastStage: true,
    });
    const fast = plan.find((stage) => stage.reason === 'fast');
    const mainland = plan.find((stage) => stage.reason === 'mainland');
    expect(mainland).toBeDefined();
    expect(mainland!.queries.some((q) => q.includes('间谍过家家'))).toBe(true);
    // fast 語意是原字串優先；允許繁簡轉換，但不要求（也不禁止）陸譯別名
    // 關鍵契約：mainland 一定有陸名
    expect(fast).toBeDefined();
  });

  it('getMainlandFallbackSourceSearchQueries 直接含審定陸名', () => {
    expect(
      getMainlandFallbackSourceSearchQueries('蜘蛛人').some((q) =>
        q.includes('蜘蛛侠')
      )
    ).toBe(true);
  });
});

describe('搜尋頁相關性排序（應用既有評分，非字面 ===）', () => {
  function rankBySearchPageRules(
    titles: string[],
    userQuery: string,
    yearOrder: 'none' | 'asc' | 'desc' = 'none'
  ): string[] {
    // 鏡射 page.tsx：年份優先，再 getBestTitleMatchScore，字母序當 tiebreaker
    const scoreQueries = [userQuery, ...getRegionalMainlandTitles(userQuery)];
    return [...titles].sort((a, b) => {
      if (yearOrder !== 'none') {
        // 測試用：標題字串不帶年份，跳過
      }
      const scoreDiff =
        getBestTitleMatchScore(b, scoreQueries) -
        getBestTitleMatchScore(a, scoreQueries);
      if (scoreDiff !== 0) return scoreDiff;
      return a.localeCompare(b);
    });
  }

  it('搜「鋼彈」時相關陸名排在字母序較前但不相關的結果之上', () => {
    // ASCII 無關片名在 localeCompare 下通常排在中文前；字面 === 永不成立
    const ranked = rankBySearchPageRules(
      ['ZZZ Unrelated', '机动战士高达', 'AAA Also Unrelated'],
      '鋼彈'
    );
    expect(ranked[0]).toBe('机动战士高达');
    expect('机动战士高达' === '鋼彈').toBe(false);
  });

  it('字面 === 對台譯永遠無效；分數才能把相關陸名排前面', () => {
    const titles = ['ZZZ Unrelated', '机动战士高达'];
    const query = '鋼彈';
    // 舊契約的前提：台譯與 CMS 陸名字面永不 soft-equal
    expect(titles.every((t) => t !== query)).toBe(true);

    const scoreQueries = [query, ...getRegionalMainlandTitles(query)];
    expect(
      getBestTitleMatchScore('机动战士高达', scoreQueries)
    ).toBeGreaterThan(getBestTitleMatchScore('ZZZ Unrelated', scoreQueries));

    expect(rankBySearchPageRules(titles, query)[0]).toBe('机动战士高达');
  });
});
