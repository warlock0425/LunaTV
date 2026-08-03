/** @jest-environment node */

import { getMainlandSearchQueries } from './mainland-search';
import { getRegionalMainlandTitles } from './regional-title-aliases';
import { isFuzzyMatch } from './searchEngine';

/**
 * 全鏈整合：台譯輸入 → 查詢計畫（regional）→ 模擬 CMS 簡體結果 → 前端 isFuzzyMatch。
 *
 * 各層單測都綠時仍可能「伺服器搜到、前端濾掉」。本檔鎖定那條端到端契約：
 * regional 表是 fork 招牌（陸源譯名橋接），比對層必須認得出計畫用過的陸名。
 */

/** 模擬搜尋頁：API 回了 CMS 結果後，用「使用者原始輸入」再濾一次 */
function clientFilter(cmsTitles: string[], userQuery: string): string[] {
  return cmsTitles.filter((title) => isFuzzyMatch(title, userQuery));
}

describe('陸源譯名橋接：查詢計畫 × 前端過濾', () => {
  it.each([
    // Opus 實測：伺服器以陸名搜到、前端用台譯 quant 濾掉
    {
      userQuery: '鋼彈',
      cmsTitle: '机动战士高达',
      plannedMustInclude: '高达',
    },
    {
      userQuery: '蜘蛛人',
      cmsTitle: '蜘蛛侠：英雄归来',
      plannedMustInclude: '蜘蛛侠',
    },
    {
      userQuery: '棋靈王',
      cmsTitle: '棋魂',
      plannedMustInclude: '棋魂',
    },
    {
      userQuery: '神隱少女',
      cmsTitle: '千与千寻',
      plannedMustInclude: '千与千寻',
    },
    // 對照：純繁簡或已有 ALIAS_MAP 的，本來就該過
    {
      userQuery: '間諜家家酒',
      cmsTitle: '间谍过家家',
      plannedMustInclude: '间谍过家家',
    },
    {
      userQuery: '葬送的芙莉蓮',
      cmsTitle: '葬送的芙莉莲',
      plannedMustInclude: '葬送的芙莉莲',
    },
  ])(
    '「$userQuery」計畫含陸名且前端保留 CMS「$cmsTitle」',
    ({ userQuery, cmsTitle, plannedMustInclude }) => {
      const regional = getRegionalMainlandTitles(userQuery);
      const planned = getMainlandSearchQueries(userQuery);

      // 計畫層：陸名必須進查詢清單（regional 或轉換）
      expect(
        planned.some(
          (q) => q.includes(plannedMustInclude) || q === plannedMustInclude
        )
      ).toBe(true);

      // 有 regional 條目時，表本身也要對
      if (regional.length > 0) {
        expect(regional.some((t) => t.includes(plannedMustInclude))).toBe(true);
      }

      // 比對層：使用者台譯 vs CMS 簡體／陸譯 —— 這才是旗艦是否生效
      expect(isFuzzyMatch(cmsTitle, userQuery)).toBe(true);

      // 搜尋頁契約：不能「Notice 顯示已用陸名搜尋、列表卻是空的」
      expect(clientFilter([cmsTitle, '完全無關的片子'], userQuery)).toEqual([
        cmsTitle,
      ]);
    }
  );

  it('短台譯「鋼彈」對短陸名「高达」不能被前端濾掉', () => {
    expect(getMainlandSearchQueries('鋼彈')[0]).toMatch(/高达/);
    expect(isFuzzyMatch('高达', '鋼彈')).toBe(true);
    expect(clientFilter(['高达'], '鋼彈')).toEqual(['高达']);
  });

  it('帶季數的台譯仍要能對上陸名結果', () => {
    expect(isFuzzyMatch('间谍过家家 第二季', '間諜家家酒 第二季')).toBe(true);
    expect(isFuzzyMatch('机动战士高达 第2季', '鋼彈 第2季')).toBe(true);
  });
});
