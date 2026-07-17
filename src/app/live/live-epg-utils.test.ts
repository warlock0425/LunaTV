import { cleanEpgData } from './live-epg-utils';

/** 以今日為基準產生 ISO 時間字串 */
function todayAt(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function dayOffsetAt(dayOffset: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe('cleanEpgData', () => {
  it('空清單原樣返回', () => {
    expect(cleanEpgData([])).toEqual([]);
  });

  it('過濾掉非今日的節目', () => {
    const programs = [
      { start: dayOffsetAt(-2, 8), end: dayOffsetAt(-2, 9), title: '前天' },
      { start: todayAt(10), end: todayAt(11), title: '今天' },
      { start: dayOffsetAt(2, 8), end: dayOffsetAt(2, 9), title: '後天' },
    ];
    const result = cleanEpgData(programs);
    expect(result.map((p) => p.title)).toEqual(['今天']);
  });

  it('保留跨天節目（跨越今日）', () => {
    const programs = [
      {
        start: dayOffsetAt(-1, 23),
        end: todayAt(1),
        title: '跨天',
      },
    ];
    expect(cleanEpgData(programs).map((p) => p.title)).toEqual(['跨天']);
  });

  it('按開始時間排序', () => {
    const programs = [
      { start: todayAt(15), end: todayAt(16), title: 'B' },
      { start: todayAt(9), end: todayAt(10), title: 'A' },
    ];
    expect(cleanEpgData(programs).map((p) => p.title)).toEqual(['A', 'B']);
  });

  it('去除時間重疊的節目，保留時長較短者', () => {
    const programs = [
      { start: todayAt(10), end: todayAt(14), title: '長節目' },
      { start: todayAt(10, 30), end: todayAt(11), title: '短節目' },
    ];
    const result = cleanEpgData(programs);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('短節目');
  });

  it('不重疊的節目全數保留', () => {
    const programs = [
      { start: todayAt(8), end: todayAt(9), title: '早' },
      { start: todayAt(9), end: todayAt(10), title: '中' },
      { start: todayAt(10), end: todayAt(11), title: '晚' },
    ];
    expect(cleanEpgData(programs)).toHaveLength(3);
  });
});
