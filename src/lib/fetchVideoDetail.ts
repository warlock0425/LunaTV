import { getAvailableApiSites } from '@/lib/config';
import { convertT2S } from '@/lib/s2t';
import { getBestTitleMatchScore } from '@/lib/searchEngine';
import { SearchResult } from '@/lib/types';

import { getDetailFromApi, searchFromApi } from './downstream';

interface FetchVideoDetailOptions {
  source: string;
  id: string;
  fallbackTitle?: string;
  /**
   * 優先直接呼叫詳情 API 取得最新資料（跳過搜尋快取）。
   * 供 cron 重新整理集數等對新鮮度敏感的場景使用；詳情失效時仍會回退到搜尋比對。
   */
  preferDetailApi?: boolean;
}

const FALLBACK_SPECIAL_KEYWORDS = [
  '特別篇',
  '外傳',
  '番外篇',
  '番外',
  '劇場版',
  '電影',
  '日記',
  'ova',
  'oad',
];

function getSpecialFallbackKeywords(title: string): string[] {
  const normalized = convertT2S((title || '').toLowerCase());
  return FALLBACK_SPECIAL_KEYWORDS.filter((keyword) =>
    normalized.includes(convertT2S(keyword.toLowerCase()))
  );
}

function hasSpecialFallbackMismatch(title: string, queries: string[]): boolean {
  const titleKeywords = getSpecialFallbackKeywords(title);
  const queryKeywords = new Set(
    queries.flatMap((query) => getSpecialFallbackKeywords(query))
  );

  return titleKeywords.some((keyword) => !queryKeywords.has(keyword));
}

function deduplicateBySourceId(items: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.source}+${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findExactSourceIdMatch(
  items: SearchResult[],
  source: string,
  id: string
): SearchResult | undefined {
  return items.find(
    (item) =>
      item.source.toString() === source.toString() &&
      item.id.toString() === id.toString()
  );
}

function findBestTitleFallback(
  items: SearchResult[],
  queries: string[]
): SearchResult | null {
  const ranked = items
    .filter((item) => (item.episodes?.length || 0) > 0)
    .filter((item) => !hasSpecialFallbackMismatch(item.title, queries))
    .map((item) => ({
      item,
      score: getBestTitleMatchScore(item.title, queries),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.item.episodes?.length || 0) - (a.item.episodes?.length || 0)
    );

  return ranked[0]?.item || null;
}

/** cron 等寫回原 key 前，確認詳情仍是同一部片，不是標題模糊匹配到的另一個 id */
export function isExactVideoDetail(
  detail: Pick<SearchResult, 'source' | 'id'>,
  source: string,
  id: string
): boolean {
  return (
    String(detail.source) === String(source) && String(detail.id) === String(id)
  );
}

/**
 * 根據 source 與 id 取得影片詳情。
 * 1. 若傳入 fallbackTitle，則先調用 /api/search 搜尋精確匹配。
 * 2. 若搜尋未命中或未提供 fallbackTitle，則直接調用 /api/detail。
 */
export async function fetchVideoDetail({
  source,
  id,
  fallbackTitle = '',
  preferDetailApi = false,
}: FetchVideoDetailOptions): Promise<SearchResult> {
  // 優先透過搜尋接口尋找精確匹配
  const apiSites = await getAvailableApiSites();
  const apiSite = apiSites.find((site) => site.key === source);
  if (!apiSite) {
    throw new Error('無效的API來源');
  }

  // 新鮮度優先：直接打詳情 API（不經搜尋快取），失敗再走搜尋回退
  if (preferDetailApi) {
    try {
      const detail = await getDetailFromApi(apiSite, id);
      if (detail && (detail.episodes?.length || 0) > 0) {
        return detail;
      }
    } catch (error) {
      // 詳情失效（如 ID 變更），改走下方搜尋回退
    }
  }

  const searchResults: SearchResult[] = [];
  const matchQueries: string[] = [];

  if (fallbackTitle) {
    try {
      // 優先使用簡體中文搜尋（因大部分影音源僅支援簡體字搜尋）
      const originalTitle = fallbackTitle.trim();
      const simplifiedTitle = convertT2S(originalTitle);
      const searchQueries = Array.from(
        new Set([simplifiedTitle, originalTitle].filter(Boolean))
      );
      matchQueries.push(...searchQueries);

      for (const query of searchQueries) {
        const results = await searchFromApi(apiSite, query);
        searchResults.push(...results);

        const exactMatch = findExactSourceIdMatch(results, source, id);
        if (exactMatch && (exactMatch.episodes?.length || 0) > 0) {
          return exactMatch;
        }
      }
    } catch (error) {
      // do nothing
    }
  }

  // 調用 /api/detail 接口（preferDetailApi 已在前面試過，不重複請求）
  if (!preferDetailApi) {
    try {
      const detail = await getDetailFromApi(apiSite, id);
      if (detail && (detail.episodes?.length || 0) > 0) {
        return detail;
      }
    } catch (error) {
      // 若原 ID 詳情失效，下面會用同片源搜尋結果做保守 fallback。
    }
  }

  const fallbackDetail = findBestTitleFallback(
    deduplicateBySourceId(searchResults),
    matchQueries
  );
  if (fallbackDetail) {
    return fallbackDetail;
  }

  throw new Error('取得影片詳情失敗');
}
