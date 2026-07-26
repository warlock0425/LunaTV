/**
 * 繁簡轉換的「哨兵測試」。
 *
 * 「繁體搜到簡體片源」是本專案的核心能力，但它整條鏈路的正確性過去沒有直接
 * 的測試把關（jest.setup.js 曾把 switch-chinese 全域 mock 成幾乎無作用，
 * 詳見該檔註解）。本檔直接驗轉換器的實際輸出，作為最前線的看守。
 *
 * 若這裡紅燈，代表換版本／換函式庫／改用法已經動到轉換結果，
 * 不要只因為其他測試仍然通過就放行。
 */

import { convertS2T, convertT2S } from './s2t';

describe('繁簡轉換（真實函式庫，未套 mock）', () => {
  it('確認載入的是真實實作（若被 mock 成無作用會在此攔下）', () => {
    expect(convertT2S('進擊')).not.toBe('進擊');
  });

  describe('繁 → 簡（送往陸源片源的方向）', () => {
    it.each([
      ['進擊的巨人', '进击的巨人'],
      ['鬼滅之刃', '鬼灭之刃'],
      ['葬送的芙莉蓮', '葬送的芙莉莲'],
      ['名偵探柯南', '名侦探柯南'],
      ['機動戰士', '机动战士'],
      ['膽大黨', '胆大党'],
    ])('%s → %s', (trad, simp) => {
      expect(convertT2S(trad)).toBe(simp);
    });
  });

  describe('簡 → 繁', () => {
    it.each([
      ['进击的巨人', '進擊的巨人'],
      ['鬼灭之刃', '鬼滅之刃'],
      ['名侦探柯南', '名偵探柯南'],
    ])('%s → %s', (simp, trad) => {
      expect(convertS2T(simp)).toBe(trad);
    });
  });

  it('空值安全', () => {
    expect(convertT2S('')).toBe('');
    expect(convertS2T('')).toBe('');
  });

  /**
   * 迴/回 在繁體是兩個字，簡體才合併為「回」。函式庫不轉是可接受的，
   * 因此 toSearchSimplified 另外保留了 迴→回 的替換。此處記錄這個已知
   * 行為，若哪天函式庫改為會轉，這條會紅燈提醒可以移除那個替換。
   */
  it('已知不轉換：迴（由 toSearchSimplified 另行補上）', () => {
    expect(convertT2S('輪迴')).toBe('轮迴');
  });
});
