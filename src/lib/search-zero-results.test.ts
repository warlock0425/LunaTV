import {
  normalizeZeroResultQuery,
  resetSearchZeroResultsMemoryForTests,
  sortZeroResultEntries,
  upsertZeroResultEntries,
} from './search-zero-results';

describe('normalizeZeroResultQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeZeroResultQuery('  魔戒  三部曲  ')).toBe('魔戒 三部曲');
  });

  it('rejects empty, too long, or non-CJK', () => {
    expect(normalizeZeroResultQuery('')).toBeNull();
    expect(normalizeZeroResultQuery('   ')).toBeNull();
    expect(normalizeZeroResultQuery('Avatar')).toBeNull();
    expect(normalizeZeroResultQuery('a'.repeat(81))).toBeNull();
    expect(normalizeZeroResultQuery('漢字'.repeat(41))).toBeNull();
  });

  it('accepts Taiwan titles with CJK', () => {
    expect(normalizeZeroResultQuery('駭客任務')).toBe('駭客任務');
    expect(normalizeZeroResultQuery('鬼滅之刃 第二季')).toBe('鬼滅之刃 第二季');
  });
});

describe('upsertZeroResultEntries', () => {
  const now = 1_700_000_000_000;

  beforeEach(() => {
    resetSearchZeroResultsMemoryForTests();
  });

  it('increments count and updates lastAt for same query', () => {
    const first = upsertZeroResultEntries([], '駭客任務', now);
    expect(first).toEqual([{ query: '駭客任務', count: 1, lastAt: now }]);

    const second = upsertZeroResultEntries(first, '  駭客任務  ', now + 10);
    expect(second).toEqual([{ query: '駭客任務', count: 2, lastAt: now + 10 }]);
  });

  it('sorts by count then recency and bounds size', () => {
    let entries = upsertZeroResultEntries([], '甲片', now, 2);
    entries = upsertZeroResultEntries(entries, '乙片', now + 1, 2);
    entries = upsertZeroResultEntries(entries, '甲片', now + 2, 2);
    // 甲 count=2, 乙 count=1
    expect(entries.map((e) => e.query)).toEqual(['甲片', '乙片']);

    // 新詞丙會擠掉次數最低的乙
    entries = upsertZeroResultEntries(entries, '丙片', now + 3, 2);
    expect(entries.map((e) => e.query)).toEqual(['甲片', '丙片']);
    expect(entries.find((e) => e.query === '甲片')?.count).toBe(2);
  });

  it('ignores non-CJK queries', () => {
    expect(upsertZeroResultEntries([], 'Avatar', now)).toEqual([]);
  });
});

describe('sortZeroResultEntries', () => {
  it('orders by count desc then lastAt desc', () => {
    const sorted = sortZeroResultEntries([
      { query: '低頻新', count: 1, lastAt: 300 },
      { query: '高頻', count: 5, lastAt: 100 },
      { query: '低頻舊', count: 1, lastAt: 100 },
    ]);
    expect(sorted.map((e) => e.query)).toEqual(['高頻', '低頻新', '低頻舊']);
  });
});
