import {
  cleanSourceName,
  normalizePlayRecordTitle,
  normalizeTitle,
  splitTitleWords,
} from './string-utils';

describe('normalizeTitle', () => {
  it('removes common suffixes like 動畫版', () => {
    expect(normalizeTitle('鬼滅之刃動畫版')).toBe(normalizeTitle('鬼滅之刃'));
  });

  it('removes season suffixes', () => {
    expect(normalizeTitle('進擊的巨人第一季')).toBe(
      normalizeTitle('進擊的巨人')
    );
  });

  it('removes Part suffixes', () => {
    expect(normalizeTitle('復仇者聯盟Part 1')).toBe(
      normalizeTitle('復仇者聯盟')
    );
  });

  it('normalizes to lowercase', () => {
    const result = normalizeTitle('Hello World');
    expect(result).toBe(result.toLowerCase());
  });

  it('strips non-CJK non-alphanumeric characters', () => {
    expect(normalizeTitle('Hello: World!')).toBe(normalizeTitle('Hello World'));
  });
});

describe('normalizePlayRecordTitle', () => {
  it('removes punctuation and whitespace', () => {
    expect(normalizePlayRecordTitle('Hello, World!')).toBe('HelloWorld');
  });

  it('handles undefined input', () => {
    expect(normalizePlayRecordTitle(undefined)).toBe('');
  });

  it('handles empty string', () => {
    expect(normalizePlayRecordTitle('')).toBe('');
  });

  it('preserves CJK characters', () => {
    expect(normalizePlayRecordTitle('鬼滅之刃')).toBe('鬼滅之刃');
  });
});

describe('cleanSourceName', () => {
  it('removes 資源 suffix', () => {
    expect(cleanSourceName('高清資源')).toBe('高清');
  });

  it('removes 片源 suffix', () => {
    expect(cleanSourceName('藍光片源')).toBe('藍光');
  });

  it('handles undefined input', () => {
    expect(cleanSourceName(undefined)).toBe('');
  });

  it('handles empty string', () => {
    expect(cleanSourceName('')).toBe('');
  });

  it('trims whitespace', () => {
    expect(cleanSourceName('  高清  ')).toBe('高清');
  });
});

/**
 * 分隔符原本寫成 /[ -:：·、-]/，` -:` 被解讀為 0x20–0x3A 的字元範圍，
 * 涵蓋所有數字與大部分 ASCII 標點。搜尋建議因此會把季數／年份切掉，
 * 「進擊的巨人第2季」變成「進擊的巨人第」和「季」。
 */
describe('splitTitleWords', () => {
  it('不以數字切分（季數、年份、續作編號必須保留）', () => {
    expect(splitTitleWords('進擊的巨人第2季')).toEqual(['進擊的巨人第2季']);
    expect(splitTitleWords('哥吉拉2014')).toEqual(['哥吉拉2014']);
    expect(splitTitleWords('7號房的禮物')).toEqual(['7號房的禮物']);
  });

  it('不以斜線、句點、括號等 ASCII 標點切分', () => {
    expect(splitTitleWords('A/B')).toEqual(['A/B']);
    expect(splitTitleWords('Dr.STONE')).toEqual(['Dr.STONE']);
    expect(splitTitleWords('Re(0)')).toEqual(['Re(0)']);
    expect(splitTitleWords('Fate+Zero')).toEqual(['Fate+Zero']);
  });

  it('以空白、連字號、半形／全形冒號、間隔號、頓號切分', () => {
    expect(splitTitleWords('鬼滅之刃 無限列車篇')).toEqual([
      '鬼滅之刃',
      '無限列車篇',
    ]);
    expect(splitTitleWords('Spider-Man')).toEqual(['Spider', 'Man']);
    expect(splitTitleWords('咒術迴戰:懷玉')).toEqual(['咒術迴戰', '懷玉']);
    expect(splitTitleWords('咒術迴戰：懷玉')).toEqual(['咒術迴戰', '懷玉']);
    expect(splitTitleWords('五等分·花嫁')).toEqual(['五等分', '花嫁']);
    expect(splitTitleWords("花's丸、日和")).toEqual(["花's丸", '日和']);
  });

  it('沒有分隔符時原樣回傳', () => {
    expect(splitTitleWords('葬送的芙莉蓮')).toEqual(['葬送的芙莉蓮']);
    expect(splitTitleWords('')).toEqual(['']);
  });
});
