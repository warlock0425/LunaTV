import { toSimplified } from './douban';

/**
 * 豆瓣 API 只認簡體參數，收到繁體時會回傳 0 筆且不報錯，
 * 症狀是「電視劇／綜藝分頁按『全部』整頁空白」，很難從畫面聯想到成因。
 *
 * 實測（2026-07-25，同一支 recommend 端點、其餘參數相同）：
 *   tags=綜藝 → 0 筆 / tags=综艺 → 5 筆
 *
 * 這裡把會被當成 API 參數送出的值鎖住，避免日後翻譯 UI 時又被改成繁體。
 */
describe('toSimplified：送往豆瓣的參數必須是簡體', () => {
  it('形式：電視劇 / 綜藝（先前缺這兩筆導致「全部」查無結果）', () => {
    expect(toSimplified('電視劇')).toBe('电视剧');
    expect(toSimplified('綜藝')).toBe('综艺');
  });

  it('一級分類', () => {
    expect(toSimplified('最近熱門')).toBe('最近热门');
    expect(toSimplified('冷門佳片')).toBe('冷门佳片');
    expect(toSimplified('番劇')).toBe('番剧');
    expect(toSimplified('劇場版')).toBe('剧场版');
  });

  it('常用類型標籤', () => {
    expect(toSimplified('劇情')).toBe('剧情');
    expect(toSimplified('喜劇')).toBe('喜剧');
    expect(toSimplified('動作')).toBe('动作');
    expect(toSimplified('愛情')).toBe('爱情');
    expect(toSimplified('懸疑')).toBe('悬疑');
  });

  it('本來就是簡體或中性的值維持原樣', () => {
    expect(toSimplified('热门')).toBe('热门');
    expect(toSimplified('华语')).toBe('华语');
    expect(toSimplified('日本')).toBe('日本');
    expect(toSimplified('更早')).toBe('更早');
  });

  it('空值安全', () => {
    expect(toSimplified('')).toBe('');
  });
});
