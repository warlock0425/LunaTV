import { toSearchSimplified } from '@/lib/chinese';
import { getMainlandSearchQueries } from '@/lib/mainland-search';

/**
 * 搜尋建議的查詢計畫（與主搜尋共用 getMainlandSearchQueries）。
 * 自 route.ts 抽出，讓測試 import production 邏輯，避免測試檔內重寫假契約。
 */

/** 建議路徑實際丟給 searchFromApi 的 primary（只取計畫第 1 個；空則原文） */
export function getSuggestionPrimaryQuery(query: string): string {
  const planned = getMainlandSearchQueries(query);
  return planned[0] || query;
}

/**
 * 從上游標題拆出的詞要能對上台譯輸入：
 * 需同時含原文、簡化、primary、全部 planned（去重）。
 */
export function getSuggestionMatchNeedles(query: string): string[] {
  const planned = getMainlandSearchQueries(query);
  const primaryQuery = planned[0] || query;
  return Array.from(
    new Set(
      [
        query.toLowerCase(),
        toSearchSimplified(query).toLowerCase(),
        primaryQuery.toLowerCase(),
        ...planned.map((p) => p.toLowerCase()),
      ].filter(Boolean)
    )
  );
}

/** 標題分詞是否應保留為建議候選 */
export function suggestionWordMatchesNeedles(
  word: string,
  needles: string[]
): boolean {
  if (word.length <= 1) return false;
  const wordLower = word.toLowerCase();
  return needles.some(
    (needle) => wordLower.includes(needle) || needle.includes(wordLower)
  );
}
