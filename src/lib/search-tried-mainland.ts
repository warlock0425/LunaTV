import { cleanQueryForApi, toSearchSimplified } from './chinese';
import { getRegionalMainlandTitles } from './regional-title-aliases';

/**
 * 空結果／提示列要秀給使用者的「實際採用中國片名」。
 * 優先：伺服器 primaryQuery → 內建台譯陸名 → 繁簡＋字元轉換。
 * 與使用者輸入相同時回 null（沒有可點的重搜價值）。
 */
export function getTriedMainlandLabel(
  query: string,
  resolvedQuery?: string
): string | null {
  const q = (query || '').trim();
  if (!q) return null;

  const resolved = (resolvedQuery || '').trim();
  const regional = getRegionalMainlandTitles(q)[0] || '';
  const simplified = toSearchSimplified(cleanQueryForApi(q));

  const target = resolved || regional || simplified;
  if (!target || target === q) return null;
  return target;
}
