import { cleanQueryForApi, toSearchSimplified } from './chinese';
import { getRegionalMainlandTitles } from './regional-title-aliases';

/** 與「用陸名再搜」導覽同一套：trim + 收合連續空白 */
function normalizeDisplayQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * 空結果／提示列要秀給使用者的「實際採用中國片名」。
 * 優先：伺服器 primaryQuery → 內建台譯陸名 → 繁簡＋字元轉換。
 * 與使用者輸入相同時回 null（沒有可點的重搜價值）。
 */
export function getTriedMainlandLabel(
  query: string,
  resolvedQuery?: string
): string | null {
  const q = normalizeDisplayQuery(query || '');
  if (!q) return null;

  const resolved = normalizeDisplayQuery(resolvedQuery || '');
  const regional = normalizeDisplayQuery(getRegionalMainlandTitles(q)[0] || '');
  const simplified = normalizeDisplayQuery(
    toSearchSimplified(cleanQueryForApi(q))
  );

  const target = resolved || regional || simplified;
  if (!target || target === q) return null;
  return target;
}
