import {
  cleanSourceName,
  normalizePlayRecordTitle,
  normalizeTitle,
  titlesMatch,
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

describe('titlesMatch', () => {
  it('matches identical titles', () => {
    expect(titlesMatch('鬼滅之刃', '鬼滅之刃')).toBe(true);
  });

  it('matches titles that differ only in suffix', () => {
    expect(titlesMatch('鬼滅之刃動畫版', '鬼滅之刃')).toBe(true);
  });

  it('matches when one title contains the other', () => {
    expect(titlesMatch('鬼滅之刃', '鬼滅之刃無限列車篇')).toBe(true);
  });

  it('does not match completely different titles', () => {
    expect(titlesMatch('鬼滅之刃', '進擊的巨人')).toBe(false);
  });
});
