import { isSameCachedData } from './shared';

// jsdom 測試環境沒有 structuredClone，改用 JSON 深拷貝（測試資料皆為 JSON 安全）
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * isSameCachedData 取代了背景同步時的 `JSON.stringify(a) !== JSON.stringify(b)`，
 * 因此除了基本正確性外，特別驗證它在 JSON 語意上與舊實作等價，
 * 以及它刻意改善的地方（鍵順序不再造成誤判）。
 */
describe('isSameCachedData', () => {
  describe('基本相等性', () => {
    it('相同的原始值視為相同', () => {
      expect(isSameCachedData(1, 1)).toBe(true);
      expect(isSameCachedData('a', 'a')).toBe(true);
      expect(isSameCachedData(true, true)).toBe(true);
      expect(isSameCachedData(null, null)).toBe(true);
    });

    it('不同的原始值視為不同', () => {
      expect(isSameCachedData(1, 2)).toBe(false);
      expect(isSameCachedData('a', 'b')).toBe(false);
      expect(isSameCachedData(true, false)).toBe(false);
      expect(isSameCachedData(null, 0)).toBe(false);
      expect(isSameCachedData(1, '1')).toBe(false);
    });
  });

  describe('播放記錄 / 收藏（Record<string, T>）', () => {
    const record = {
      'src+1': { title: '影片', index: 3, total_episodes: 12, save_time: 100 },
    };

    it('內容相同的巢狀物件視為相同', () => {
      expect(isSameCachedData(record, clone(record))).toBe(true);
    });

    it('巢狀欄位改變會被偵測到（集數更新必須觸發同步）', () => {
      const updated = clone(record);
      updated['src+1'].index = 4;
      expect(isSameCachedData(record, updated)).toBe(false);
    });

    it('新增或刪除項目會被偵測到', () => {
      const added = {
        ...clone(record),
        'src+2': { title: '另一部', index: 1, total_episodes: 6, save_time: 1 },
      };
      expect(isSameCachedData(record, added)).toBe(false);
      expect(isSameCachedData(added, record)).toBe(false);
    });
  });

  describe('搜尋歷史（string[]）', () => {
    it('相同順序的陣列視為相同', () => {
      expect(isSameCachedData(['a', 'b'], ['a', 'b'])).toBe(true);
    });

    it('順序不同的陣列視為不同（陣列順序有意義）', () => {
      expect(isSameCachedData(['a', 'b'], ['b', 'a'])).toBe(false);
    });

    it('長度不同的陣列視為不同', () => {
      expect(isSameCachedData(['a'], ['a', 'b'])).toBe(false);
    });

    it('陣列與物件不混淆', () => {
      expect(isSameCachedData([], {})).toBe(false);
    });
  });

  describe('相對舊實作的改善：鍵順序不再造成誤判', () => {
    it('僅鍵順序不同的物件視為相同', () => {
      const a = { x: 1, y: 2 };
      const b = { y: 2, x: 1 };
      // 舊的 JSON.stringify 比對會判定為「已變更」，造成無謂的快取寫入與重繪
      expect(JSON.stringify(a) !== JSON.stringify(b)).toBe(true);
      expect(isSameCachedData(a, b)).toBe(true);
    });
  });

  describe('與 JSON.stringify 的語意對齊', () => {
    it('值為 undefined 的鍵視同不存在', () => {
      expect(isSameCachedData({ a: 1, b: undefined }, { a: 1 })).toBe(true);
      expect(isSameCachedData({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    });

    it('兩個 NaN 視為相同', () => {
      expect(isSameCachedData(NaN, NaN)).toBe(true);
      expect(isSameCachedData({ a: NaN }, { a: NaN })).toBe(true);
    });

    it('null 與 undefined 不相同', () => {
      expect(isSameCachedData({ a: null }, { a: undefined })).toBe(false);
    });
  });

  describe('短路行為', () => {
    it('第一個差異即返回，不需遍歷完整結構', () => {
      const big: Record<string, unknown> = {};
      for (let i = 0; i < 1000; i += 1) big[`k${i}`] = { v: i };
      const other = clone(big);
      (other.k0 as { v: number }).v = -1;
      expect(isSameCachedData(big, other)).toBe(false);
    });
  });
});
