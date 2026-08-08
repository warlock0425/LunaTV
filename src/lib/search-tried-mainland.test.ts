import { getRegionalMainlandTitles } from './regional-title-aliases';
import { getTriedMainlandLabel } from './search-tried-mainland';

describe('getTriedMainlandLabel', () => {
  it('prefer server resolved primary over regional/simplified', () => {
    // 用內建表取值，避免測試檔寫入簡體字面量被 check-simplified 擋下
    const resolved = getRegionalMainlandTitles('駭客任務')[0];
    expect(resolved).toBeTruthy();
    expect(getTriedMainlandLabel('星際大戰', resolved)).toBe(resolved);
  });

  it('falls back to curated regional alias', () => {
    const expected = getRegionalMainlandTitles('駭客任務')[0];
    expect(expected).toBeTruthy();
    expect(getTriedMainlandLabel('駭客任務')).toBe(expected);
  });

  it('falls back to simplified conversion when no alias', () => {
    const label = getTriedMainlandLabel('鬼滅之刃');
    expect(label).toBeTruthy();
    expect(label).not.toBe('鬼滅之刃');
  });

  it('returns null when nothing distinct', () => {
    expect(getTriedMainlandLabel('')).toBeNull();
    expect(getTriedMainlandLabel('Avatar')).toBeNull();
    const same = getRegionalMainlandTitles('駭客任務')[0];
    expect(same).toBeTruthy();
    expect(getTriedMainlandLabel(same!, same)).toBeNull();
  });
});
