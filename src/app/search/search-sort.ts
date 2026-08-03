import { getRegionalMainlandTitles } from '@/lib/regional-title-aliases';
import { getBestTitleMatchScore } from '@/lib/searchEngine';

export type SearchYearOrder = 'none' | 'asc' | 'desc';

/**
 * 搜尋結果排序：年份 → 標題相關性評分 → 字母序 tiebreaker。
 * 自 page.tsx 抽出以便單元測試鎖住「台譯不可靠字面 ===」的契約。
 */

export function compareSearchYears(
  aYear: string,
  bYear: string,
  order: SearchYearOrder
): number {
  if (order === 'none') return 0;
  const aIsEmpty = !aYear || aYear === 'unknown';
  const bIsEmpty = !bYear || bYear === 'unknown';
  if (aIsEmpty && bIsEmpty) return 0;
  if (aIsEmpty) return 1;
  if (bIsEmpty) return -1;
  const aNum = parseInt(aYear, 10);
  const bNum = parseInt(bYear, 10);
  return order === 'asc' ? aNum - bNum : bNum - aNum;
}

/** 評分用查詢：使用者輸入 + regional 陸名（與比對層同一張表） */
export function getSearchScoreQueries(userQuery: string): string[] {
  const query = userQuery.trim();
  if (!query) return [];
  return [query, ...getRegionalMainlandTitles(query)];
}

/**
 * 標題相關性比較（分數高者在前）。
 * titleOrder 控制同分時的字母序方向，與既有「依年份排序時的標題次序」一致。
 */
export function compareSearchTitleRelevance(
  aTitle: string,
  bTitle: string,
  scoreQueries: string[],
  titleOrder: 'asc' | 'desc' = 'asc'
): number {
  const scoreDiff =
    getBestTitleMatchScore(bTitle, scoreQueries) -
    getBestTitleMatchScore(aTitle, scoreQueries);
  if (scoreDiff !== 0) return scoreDiff;
  return titleOrder === 'asc'
    ? aTitle.localeCompare(bTitle)
    : bTitle.localeCompare(aTitle);
}

/**
 * 搜尋結果排序（預設路徑也會跑）。
 * yearOrder === 'none' 時跳過年份、只依相關性；有年份排序時年份優先再相關性。
 * page.tsx 必須呼叫此函式，不可在 yearOrder none 時提前 return。
 */
export function sortSearchItems<T extends { title: string; year?: string }>(
  items: T[],
  userQuery: string,
  yearOrder: SearchYearOrder
): T[] {
  if (items.length <= 1) return items;
  const scoreQueries = getSearchScoreQueries(userQuery);
  const titleOrder: 'asc' | 'desc' = yearOrder === 'desc' ? 'desc' : 'asc';
  return [...items].sort((a, b) => {
    const yearComp = compareSearchYears(
      a.year ?? 'unknown',
      b.year ?? 'unknown',
      yearOrder
    );
    if (yearComp !== 0) return yearComp;
    return compareSearchTitleRelevance(
      a.title,
      b.title,
      scoreQueries,
      titleOrder
    );
  });
}
