import {
  extractPart,
  extractSeason,
  inferSeasonFromSubtitle,
  parseChineseNumber,
} from './titleParser';

describe('parseChineseNumber', () => {
  test('converts simple Chinese digits (一-九) to 1-9', () => {
    expect(parseChineseNumber('一')).toBe(1);
    expect(parseChineseNumber('九')).toBe(9);
  });

  test('converts 十 to 10', () => {
    expect(parseChineseNumber('十')).toBe(10);
  });

  test('converts compound 十+digit like 十二 to 12', () => {
    expect(parseChineseNumber('十二')).toBe(12);
  });

  test('converts digit+十 like 二十 to 20', () => {
    expect(parseChineseNumber('二十')).toBe(20);
  });

  test('converts three-char compound like 二十三 to 23', () => {
    expect(parseChineseNumber('二十三')).toBe(23);
  });

  test('returns 0 for unknown characters', () => {
    expect(parseChineseNumber('abc')).toBe(0);
  });

  test('returns 0 for empty string', () => {
    expect(parseChineseNumber('')).toBe(0);
  });
});

describe('inferSeasonFromSubtitle', () => {
  test('maps traditional Chinese subtitle to season number', () => {
    expect(inferSeasonFromSubtitle('科學與未來')).toBe(4);
  });

  test('maps simplified Chinese subtitle to season number', () => {
    expect(inferSeasonFromSubtitle('科学与未来')).toBe(4);
  });

  test('maps 柱訓練 to season 4', () => {
    expect(inferSeasonFromSubtitle('柱訓練')).toBe(4);
  });

  test('maps 游郭/遊郭 variants to season 2', () => {
    expect(inferSeasonFromSubtitle('游郭')).toBe(2);
    expect(inferSeasonFromSubtitle('遊郭')).toBe(2);
  });

  test('maps 無限列車 to season 1', () => {
    expect(inferSeasonFromSubtitle('無限列車')).toBe(1);
  });

  test('handles case insensitive English subtitle like Final Season', () => {
    expect(inferSeasonFromSubtitle('Final Season')).toBe(4);
  });

  test('returns null for empty string', () => {
    expect(inferSeasonFromSubtitle('')).toBeNull();
  });

  test('returns null for null input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(inferSeasonFromSubtitle(null as any)).toBeNull();
  });

  test('returns null for unrecognized text', () => {
    expect(inferSeasonFromSubtitle('random text')).toBeNull();
  });
});

describe('extractPart', () => {
  test('extracts Chinese number part like 第三部分', () => {
    expect(extractPart('第三部分')).toBe(3);
  });

  test('extracts Arabic number part like 第2部分', () => {
    expect(extractPart('第2部分')).toBe(2);
  });

  test('extracts English Part N', () => {
    expect(extractPart('Part 3')).toBe(3);
  });

  test('extracts pt shorthand like pt2', () => {
    expect(extractPart('pt2')).toBe(2);
  });

  test('extracts prat (common CMS typo) like prat1', () => {
    expect(extractPart('prat1')).toBe(1);
  });

  test('returns null for empty string', () => {
    expect(extractPart('')).toBeNull();
  });

  test('returns null for null input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(extractPart(null as any)).toBeNull();
  });

  test('returns null when no part pattern found', () => {
    expect(extractPart('no part here')).toBeNull();
  });
});

describe('extractSeason', () => {
  test('extracts Chinese ordinal with 季 like 第二季', () => {
    expect(extractSeason('第二季')).toBe(2);
  });

  test('extracts Chinese ordinal with 期 like 第3期', () => {
    expect(extractSeason('第3期')).toBe(3);
  });

  test('extracts Chinese ordinal with 部 (not 部分) like 第四部', () => {
    expect(extractSeason('第四部')).toBe(4);
  });

  test('extracts English Season N', () => {
    expect(extractSeason('Season 2')).toBe(2);
  });

  test('extracts S01 format', () => {
    expect(extractSeason('S01')).toBe(1);
  });

  test('extracts Part N pattern', () => {
    expect(extractSeason('Title Part 3')).toBe(3);
  });

  test('extracts Roman numeral III with leading space', () => {
    expect(extractSeason('Title III')).toBe(3);
  });

  test('extracts Roman numeral IV with leading space', () => {
    expect(extractSeason('Title IV')).toBe(4);
  });

  test('extracts trailing number like 史萊姆 4', () => {
    expect(extractSeason('史萊姆 4')).toBe(4);
  });

  test('falls back to subtitle inference like 科學與未來', () => {
    expect(extractSeason('科學與未來')).toBe(4);
  });

  test('returns null for empty string', () => {
    expect(extractSeason('')).toBeNull();
  });

  test('returns null for null input', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(extractSeason(null as any)).toBeNull();
  });
});
