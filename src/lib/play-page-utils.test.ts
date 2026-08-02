import {
  calculateSourceScore,
  filterSourcesPreferHighQuality,
  formatPlayerTime,
  getStableTitle,
  isBelowPreferredDisplayQuality,
  isPreferredDisplayQuality,
  parseLoadSpeedKBps,
} from './play-page-utils';

describe('畫質優先過濾（換源列表）', () => {
  it('識別 1080p+ 與低畫質', () => {
    expect(isPreferredDisplayQuality('1080p')).toBe(true);
    expect(isPreferredDisplayQuality('4K')).toBe(true);
    expect(isPreferredDisplayQuality('720p')).toBe(false);
    expect(isBelowPreferredDisplayQuality('720p')).toBe(true);
    expect(isBelowPreferredDisplayQuality('480p')).toBe(true);
    expect(isBelowPreferredDisplayQuality('未知')).toBe(false);
  });

  it('有 1080p 時隱藏 720p／480p，保留當前、失敗與未測速', () => {
    const sources = [
      { source: 'a', id: '1' }, // 1080
      { source: 'b', id: '2' }, // 720
      { source: 'c', id: '3' }, // 480
      { source: 'd', id: '4' }, // error
      { source: 'e', id: '5' }, // pending
      { source: 'f', id: '6' }, // current 720 — 仍應保留
    ];
    const info: Record<string, { quality: string; hasError?: boolean }> = {
      'a-1': { quality: '1080p' },
      'b-2': { quality: '720p' },
      'c-3': { quality: '480p' },
      'd-4': { quality: '錯誤', hasError: true },
      'f-6': { quality: '720p' },
    };
    const result = filterSourcesPreferHighQuality(sources, {
      currentSource: 'f',
      currentId: '6',
      getInfo: (k) => info[k],
    });
    expect(result.map((s) => `${s.source}-${s.id}`)).toEqual([
      'a-1',
      'd-4',
      'e-5',
      'f-6',
    ]);
  });

  it('完全沒有 1080p+ 時不過濾', () => {
    const sources = [
      { source: 'a', id: '1' },
      { source: 'b', id: '2' },
    ];
    const info = {
      'a-1': { quality: '720p' },
      'b-2': { quality: '480p' },
    };
    const result = filterSourcesPreferHighQuality(sources, {
      getInfo: (k) => info[k as keyof typeof info],
    });
    expect(result).toHaveLength(2);
  });
});

describe('play page pure helpers', () => {
  it('picks the first usable stable title', () => {
    expect(getStableTitle(undefined, ' ', 'undefined', 'My Anime')).toBe(
      'My Anime'
    );
    expect(getStableTitle(' null ', 'Fallback')).toBe('Fallback');
    expect(getStableTitle('影片標題', 'Real Title')).toBe('Real Title');
  });

  it('formats player time using the current play page behavior', () => {
    expect(formatPlayerTime(0)).toBe('00:00');
    expect(formatPlayerTime(65)).toBe('01:05');
    expect(formatPlayerTime(3661)).toBe('01:01:01');
  });

  it('parses speed labels to KB/s', () => {
    expect(parseLoadSpeedKBps('800 KB/s')).toBe(800);
    expect(parseLoadSpeedKBps('2.5 MB/s')).toBe(2560);
    expect(parseLoadSpeedKBps('未知')).toBe(0);
    expect(parseLoadSpeedKBps('測量中...')).toBe(0);
    expect(parseLoadSpeedKBps('invalid')).toBe(0);
  });

  it('keeps the original fallback score for unknown speed labels', () => {
    expect(
      calculateSourceScore(
        { quality: '720p', loadSpeed: '未知', pingTime: 100 },
        1024,
        50,
        1000
      )
    ).toBe(53);
    expect(
      calculateSourceScore(
        { quality: '720p', loadSpeed: '測量中...', pingTime: 100 },
        1024,
        50,
        1000
      )
    ).toBe(53);
  });

  it('keeps high-quality fast sources ahead in source scoring', () => {
    const fast1080 = calculateSourceScore(
      { quality: '1080p', loadSpeed: '2 MB/s', pingTime: 80 },
      2048,
      80,
      200
    );
    const slow480 = calculateSourceScore(
      { quality: '480p', loadSpeed: '200 KB/s', pingTime: 300 },
      2048,
      80,
      300
    );

    expect(fast1080).toBeGreaterThan(slow480);
    expect(fast1080).toBe(135);
  });
});
