import {
  calculateSourceScore,
  formatPlayerTime,
  getStableTitle,
  parseLoadSpeedKBps,
} from './play-page-utils';

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
