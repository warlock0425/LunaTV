/** @jest-environment node */

import {
  getSuggestionMatchNeedles,
  getSuggestionPrimaryQuery,
  suggestionWordMatchesNeedles,
} from './suggestion-queries';

/**
 * import production 函式（route.ts 同一份）。
 * 若把 getSuggestionPrimaryQuery 改成不呼叫 getMainlandSearchQueries
 * （例如直接 return query），鋼彈／蜘蛛人／棋靈王三條必須紅。
 */
describe('suggestion-queries（搜尋建議 production 查詢計畫）', () => {
  it.each([
    ['鋼彈', '高达'],
    ['蜘蛛人', '蜘蛛侠'],
    ['棋靈王', '棋魂'],
  ])('getSuggestionPrimaryQuery「%s」必須含「%s」', (userQuery, mainland) => {
    expect(getSuggestionPrimaryQuery(userQuery)).toContain(mainland);
  });

  it('無 CJK 時 primary 退回原文', () => {
    expect(getSuggestionPrimaryQuery('Attack on Titan')).toBe(
      'Attack on Titan'
    );
  });

  it('getSuggestionMatchNeedles 含台譯、簡化與陸名', () => {
    const needles = getSuggestionMatchNeedles('鋼彈');
    expect(needles.some((n) => n.includes('鋼彈') || n.includes('钢弹'))).toBe(
      true
    );
    expect(needles.some((n) => n.includes('高达'))).toBe(true);
  });

  it('suggestionWordMatchesNeedles：陸名分詞能對上台譯 needles', () => {
    const needles = getSuggestionMatchNeedles('鋼彈');
    expect(suggestionWordMatchesNeedles('高达', needles)).toBe(true);
    expect(suggestionWordMatchesNeedles('x', needles)).toBe(false);
  });
});
