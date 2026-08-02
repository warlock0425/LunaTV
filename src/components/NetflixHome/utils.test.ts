import {
  formatEpisodeLabel,
  formatSourceLabel,
  getWatchProgress,
  resolveRecordPlayTarget,
} from './utils';

describe('formatEpisodeLabel', () => {
  it('有總集數時顯示 x / y', () => {
    expect(formatEpisodeLabel({ index: 2, total_episodes: 12 })).toBe(
      '第 2 / 12 集'
    );
  });

  it('沒有總集數時只顯示當前集', () => {
    expect(formatEpisodeLabel({ index: 3, total_episodes: 0 })).toBe('第 3 集');
    expect(formatEpisodeLabel({ index: 3 })).toBe('第 3 集');
  });
});

describe('formatSourceLabel', () => {
  it('去掉來源名稱前綴的 🎬', () => {
    expect(formatSourceLabel({ source_name: '🎬 非凡資源' })).toBe('非凡資源');
  });

  it('沒有 source_name 時退回傳入的來源', () => {
    expect(formatSourceLabel({}, 'ffzy')).toBe('ffzy');
    expect(formatSourceLabel({ source: 'dyttzy' })).toBe('dyttzy');
  });
});

describe('getWatchProgress', () => {
  it('依 play_time / total_time 計算百分比', () => {
    expect(getWatchProgress({ play_time: 720, total_time: 1440 })).toBe(50);
  });

  it('total_time 缺漏時回傳 0，交由呼叫端隱藏進度條', () => {
    expect(getWatchProgress({ play_time: 500, total_time: 0 })).toBe(0);
    expect(getWatchProgress({ play_time: 500 })).toBe(0);
  });

  it('夾在 0 到 100 之間', () => {
    expect(getWatchProgress({ play_time: 9999, total_time: 100 })).toBe(100);
    expect(getWatchProgress({ play_time: -50, total_time: 100 })).toBe(0);
  });

  it('回傳整數百分比（避免 UI 顯示過長浮點）', () => {
    // 560/1300 ≈ 43.0769… → 43
    expect(getWatchProgress({ play_time: 560, total_time: 1300 })).toBe(43);
  });
});

describe('resolveRecordPlayTarget', () => {
  it('優先採用 key 解析出的來源與 ID', () => {
    expect(
      resolveRecordPlayTarget({ key: 'ffzy+123', source: 'other', id: '999' })
    ).toEqual({ source: 'ffzy', id: '123', isPrefer: false });
  });

  it('沒有 key 時退回欄位本身', () => {
    expect(resolveRecordPlayTarget({ source: 'dyttzy', id: '456' })).toEqual({
      source: 'dyttzy',
      id: '456',
      isPrefer: false,
    });
  });

  it('把字串 undefined / null 視為缺漏並改走 prefer', () => {
    expect(
      resolveRecordPlayTarget({ source: 'undefined', id: 'null' })
    ).toEqual({ source: '', id: '', isPrefer: true });
  });

  it('來源或 ID 缺一就走 prefer', () => {
    expect(resolveRecordPlayTarget({ source: 'ffzy' })).toEqual({
      source: 'ffzy',
      id: '',
      isPrefer: true,
    });
  });
});
