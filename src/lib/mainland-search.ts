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
    .map((variant) => normalizeMainlandQuery(variant))
    .filter(
      (variant) =>
        variant &&
        CJK_PATTERN.test(variant) &&
        !KANA_PATTERN.test(variant) &&
        (season === null || extractSeason(variant) === season)
    );

  const titleParts = query
    .split(/[，,：:｜|—–-]+/)
    .map((part) => normalizeMainlandQuery(part, true))
    .filter((part) => CJK_PATTERN.test(part) && part.length >= 4);

  return Array.from(
    new Set([...regionalAliases, exact, ...titleParts, ...generated])
  ).slice(0, MAX_MAINLAND_SEARCH_QUERIES);
}
