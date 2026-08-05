/** @jest-environment node */

import { getMainlandSearchQueries } from '@/lib/mainland-search';

/**
 * 搜尋建議必須與主搜尋共用陸名計畫（至少第 1 個查詢）。
 * 鎖「鋼彈 → 高达」等旗艦案例；拿掉 getMainlandSearchQueries 接線後必須紅。
 *
 * 完整 route 需 mock 大量依賴；此處鎖計畫契約與 generateSuggestions 會用到的 primary。
 */
describe('搜尋建議陸名計畫契約', () => {
  function primarySuggestionQuery(userQuery: string): string {
    const planned = getMainlandSearchQueries(userQuery);
    return planned[0] || userQuery;
  }

  it.each([
    ['鋼彈', '高达'],
    ['蜘蛛人', '蜘蛛侠'],
    ['棋靈王', '棋魂'],
  ])('「%s」建議路徑 primary 必須含「%s」', (userQuery, mainland) => {
    const primary = primarySuggestionQuery(userQuery);
    expect(primary).toContain(mainland);
  });

  it('無 CJK 時允許退回原文（與 getMainlandSearchQueries 空清單一致）', () => {
    expect(primarySuggestionQuery('Attack on Titan')).toBe('Attack on Titan');
  });
});
