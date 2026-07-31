import {
  cleanQueryForApi,
  generateSearchVariants,
  toSearchSimplified,
} from './chinese';
import { convertTaiwanToMainland } from './opencc-mainland';
import { getRegionalMainlandTitles } from './regional-title-aliases';
import { extractSeason } from './titleParser';

const CJK_PATTERN = /[\u3400-\u9fff]/;
const KANA_PATTERN = /[\u3040-\u30ff]/;
const MAX_MAINLAND_SEARCH_QUERIES = 6;

function normalizeMainlandQuery(
  value: string,
  preserveMetadata = false
): string {
  const input = preserveMetadata ? value : cleanQueryForApi(value || '');
  return toSearchSimplified(convertTaiwanToMainland(input))
    .replace(/[【】[\]（）()《》]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a small, ordered query plan for mainland CMS sources.
 *
 * The exact simplified-Chinese query always runs first. Broader generated
 * variants are only fallbacks and never include Japanese or English titles.
 */
export function getMainlandSearchQueries(query: string): string[] {
  const exact = normalizeMainlandQuery(query, true);
  if (!exact || !CJK_PATTERN.test(exact) || KANA_PATTERN.test(query)) return [];

  const season = extractSeason(query);
  const regionalAliases = getRegionalMainlandTitles(query).map((alias) =>
    normalizeMainlandQuery(alias, true)
  );
  const generated = generateSearchVariants(query)
    // 季數比對必須在正規化「之前」做。normalizeMainlandQuery 預設會呼叫
    // cleanQueryForApi 把季數剝掉，剝完再比對 extractSeason(variant) === season
    // 必然不相等——結果是只要查詢帶明確季數，所有生成變體都被濾光，
    // 該查詢完全沒有備援（例如「鬼滅之刃 第二季」只送得出一個查詢）。
    .filter((variant) => season === null || extractSeason(variant) === season)
    // 帶季數時保留 metadata，讓季數留在實際送出的查詢裡；不帶季數時維持
    // 原本的行為（剝除季數等中繼資訊以提高片源命中率）。
    .map((variant) => normalizeMainlandQuery(variant, season !== null))
    .filter(
      (variant) =>
        variant && CJK_PATTERN.test(variant) && !KANA_PATTERN.test(variant)
    );

  const titleParts = query
    .split(/[，,：:｜|—–-]+/)
    .map((part) => normalizeMainlandQuery(part, true))
    .filter((part) => CJK_PATTERN.test(part) && part.length >= 4);

  return Array.from(
    new Set([...regionalAliases, exact, ...titleParts, ...generated])
  ).slice(0, MAX_MAINLAND_SEARCH_QUERIES);
}
