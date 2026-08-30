import {
  cleanQueryForApi,
  generateNumberVariant,
  generateSearchVariants,
  isCjkSearchQuery,
  shouldPreserveSourceDisplayName,
  toDisplayLanguage,
  toSearchSimplified,
} from './chinese';

/**
 * generateSearchVariants 的 golden test。
 *
 * 這支函式負責產生「要拿去問片源的候選片名」，是本 fork 繁簡／台譯橋接的核心，
 * 但先前 500 多行邏輯完全沒有測試。它同時餵給 getMainlandSearchQueries，
 * 一改動就會直接改變實際送出的查詢。
 *
 * 用整體快照而非逐項斷言：變體清單的「內容與順序」都有意義（順序決定先試哪個
 * 查詢），任何增刪或排序變動都應該在 review 時被看見。要刻意變更時
 * 用 `pnpm test -- -u` 更新並檢視 diff。
 */
describe('generateSearchVariants golden test', () => {
  const CASES = [
    ['別名表命中（繁）', '進擊的巨人'],
    ['別名表命中（簡）', '进击的巨人'],
    ['別名表＋季數', '鬼滅之刃 第二季'],
    ['別名表＋副標題', '咒術迴戰 懷玉玉折'],
    ['台譯與陸名不同', '海賊王'],
    ['台譯與陸名完全不同', '間諜家家酒'],
    ['僅需字元轉換', '葬送的芙莉蓮'],
    ['全形英數', 'Ｄｒ．ＳＴＯＮＥ'],
    ['尾綴數字轉季數', '哈利波特2'],
    ['空白＋季數合併', '鋼之鍊金術師 第一季'],
    ['純英文', 'Breaking Bad'],
    ['日文假名', 'ほっかいどうぶつ'],
  ] as const;

  it.each(CASES)('%s：%s', (_label, query) => {
    expect(generateSearchVariants(query)).toMatchSnapshot();
  });

  it('去除首尾空白後才產生變體', () => {
    expect(generateSearchVariants('  進擊的巨人  ')).toEqual(
      generateSearchVariants('進擊的巨人')
    );
  });

  it('空字串不會爆炸', () => {
    expect(() => generateSearchVariants('')).not.toThrow();
    expect(() => generateSearchVariants('   ')).not.toThrow();
  });

  it('原始查詢一定是第一個變體（片源優先試使用者實際輸入的字）', () => {
    for (const [, query] of CASES) {
      expect(generateSearchVariants(query)[0]).toBe(query.trim());
    }
  });

  it('不把英文／日文原文加進搜尋變體，只留繁轉簡與中文陸名', () => {
    expect(generateSearchVariants('海賊王')).toContain('航海王');
    expect(generateSearchVariants('海賊王')).toContain('海贼王');
    expect(generateSearchVariants('海賊王')).not.toContain('One Piece');
    expect(generateSearchVariants('進擊的巨人')).toContain('进击的巨人');
    expect(generateSearchVariants('進擊的巨人')).not.toContain(
      'Attack on Titan'
    );
    expect(generateSearchVariants('ほっかいどうぶつ')).toContain('北海道动物');
    expect(generateSearchVariants('ほっかいどうぶつ')).not.toContain(
      'Hokkaido Animals'
    );
    expect(generateSearchVariants('ほっかいどうぶつ')).not.toContain(
      'ほっかいどうぶつ学園'
    );
  });
});

describe('isCjkSearchQuery', () => {
  it('accepts Chinese and rejects English or kana originals', () => {
    expect(isCjkSearchQuery('海賊王')).toBe(true);
    expect(isCjkSearchQuery('海贼王')).toBe(true);
    expect(isCjkSearchQuery('One Piece')).toBe(false);
    expect(isCjkSearchQuery('進撃の巨人')).toBe(false);
    expect(isCjkSearchQuery('Attack on Titan')).toBe(false);
  });
});

/**
 * generateNumberVariant 是「雙向」的：中文季數 ↔ 阿拉伯數字都會轉。
 * 撰寫本測試時我原本假設它只做「阿拉伯 → 中文」，實測才發現不是——
 * 這個契約先前沒有任何測試記錄下來。
 */
describe('generateNumberVariant', () => {
  it('中文季數 → 去掉季數並接上阿拉伯數字', () => {
    expect(generateNumberVariant('鬼滅之刃 第二季')).toBe('鬼滅之刃2');
    expect(generateNumberVariant('間諜家家酒第三季')).toBe('間諜家家酒3');
  });

  it('「第N季」的阿拉伯數字 → 中文數字（原地取代，不搬到字尾）', () => {
    expect(generateNumberVariant('鬼滅之刃 第2季')).toBe('鬼滅之刃 第二季');
  });

  it('尾綴裸數字 → 補成「第N季」', () => {
    expect(generateNumberVariant('哈利波特2')).toBe('哈利波特第二季');
    expect(generateNumberVariant('葬送的芙莉蓮3')).toBe('葬送的芙莉蓮第三季');
  });

  it('季／部／集／期都認得', () => {
    expect(generateNumberVariant('某劇第三部')).toBe('某劇3');
    expect(generateNumberVariant('某劇第四集')).toBe('某劇4');
    expect(generateNumberVariant('某劇第五期')).toBe('某劇5');
  });

  it('超出一到十的範圍不轉換', () => {
    expect(generateNumberVariant('某劇11')).toBeNull();
    expect(generateNumberVariant('某劇第11季')).toBeNull();
  });

  it('沒有任何數字或季數時回傳 null', () => {
    expect(generateNumberVariant('進擊的巨人')).toBeNull();
    expect(generateNumberVariant('葬送的芙莉蓮')).toBeNull();
  });
});

describe('toSearchSimplified', () => {
  it('繁轉簡供陸源搜尋使用', () => {
    expect(toSearchSimplified('進擊的巨人')).toBe('进击的巨人');
    expect(toSearchSimplified('葬送的芙莉蓮')).toBe('葬送的芙莉莲');
  });

  it('已是簡體時維持原樣', () => {
    expect(toSearchSimplified('进击的巨人')).toBe('进击的巨人');
  });
});

describe('toDisplayLanguage', () => {
  it('把陸源回傳的簡體詞彙轉為台灣用語', () => {
    expect(toDisplayLanguage('这是简体的缓存设置')).toBe('這是簡體的快取設定');
  });

  it('🎬 前綴片源名稱維持原文（簡體、符號、emoji 都不動）', () => {
    expect(shouldPreserveSourceDisplayName('🎬iKun资源')).toBe(true);
    expect(shouldPreserveSourceDisplayName('🎬某某资源')).toBe(true);
    expect(shouldPreserveSourceDisplayName('电影天堂资源')).toBe(false);
    expect(toDisplayLanguage('🎬iKun资源')).toBe('🎬iKun资源');
    expect(toDisplayLanguage('🎬某某资源')).toBe('🎬某某资源');
    expect(toDisplayLanguage('  🎬测试源 ')).toBe('  🎬测试源 ');
    // 沒有 🎬 前綴的仍會轉繁體／台灣用語
    expect(toDisplayLanguage('电影天堂资源')).toBe('電影天堂資源');
  });
});

describe('cleanQueryForApi', () => {
  it('剝除季數等中繼資訊以提高片源命中率', () => {
    expect(cleanQueryForApi('鬼滅之刃 第二季')).toBe('鬼滅之刃');
  });

  it('沒有中繼資訊時維持原樣', () => {
    expect(cleanQueryForApi('進擊的巨人')).toBe('進擊的巨人');
  });
});
