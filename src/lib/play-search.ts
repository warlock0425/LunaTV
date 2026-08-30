import { normalizeAliasList } from '@/lib/bangumi-aliases';
import { cleanQueryForApi, toSearchSimplified } from '@/lib/chinese';
import { logger } from '@/lib/logger';
import { getMainlandSearchQueries } from '@/lib/mainland-search';
import { getResultEpisodeCount } from '@/lib/play-page-utils';
import { convertT2S } from '@/lib/s2t';
import { getBestTitleMatchScore, isFuzzyMatch } from '@/lib/searchEngine';
import { SearchResult } from '@/lib/types';

import { extractPart, extractSeason } from './titleParser';

export { normalizeAliasList } from '@/lib/bangumi-aliases';

const SOURCE_TITLE_SEPARATOR_PATTERN =
  /[\s~～\-－—–・·,，.。:：!！?？《》「」『』【】（）()_、/\\|]+/g;
const KANA_PATTERN = /[\u3040-\u30fa\u30fc-\u30ff]/;
const CJK_PATTERN = /[\u3400-\u9fff]/;
const TITLE_BRACKET_PATTERN = /[([【（][^)\]】）]{1,24}[)\]】）]/g;
const PARTICLE_SPLIT_PATTERN =
  /\u597d\u50cf\u662f|\u4e0d\u662f|\u4e5f\u4e0d\u662f|\u4e00\u6837|\u7684|\u548c|\u4e0e|\u53ca/g;
const LEADING_TITLE_NOISE_PATTERN = /^(?:\u5be6\u969b|\u5b9e\u9645)/;
const WEAK_CORE_SEGMENTS = new Set([
  '\u6837\u5b50',
  '\u804c\u4e1a',
  '\u52c7\u8005',
  '\u8d24\u8005',
  '\u6700\u5f3a',
]);
const MAINLAND_CHAR_FIXES: Record<string, string> = {
  '\u5f37': '\u5f3a',
  '\u8077': '\u804c',
  '\u696d': '\u4e1a',
  '\u8ce2': '\u8d24',
  '\u6a23': '\u6837',
  '\u9451': '\u9274',
  '\u50de': '\u4f2a',
  '\u507d': '\u4f2a',
};
const TRANSLATION_FALLBACK_MAX_QUERIES = 4;
const TRANSLATION_SEASON_MARKER_PATTERN =
  /第[一二三四五六七八九十\d]+[季期部]|\b(?:season|part|s)\s*\d+\b/gi;
const TRANSLATION_SPECIAL_PATTERN =
  /(劇場版|\u5267\u573a\u7248|電影版|\u7535\u5f71\u7248|特別篇|\u7279\u522b\u7bc7|外傳|\u5916\u4f20|番外|ova|oad)/gi;
const TRANSLATION_WEAK_FRAGMENT_EDGE_PATTERN =
  /^(?:的|之|與|与|和|及)|(?:的|之)$/;

export type PlaybackSearchPlanStageReason =
  | 'fast'
  | 'mainland'
  | 'bangumi-alias'
  | 'search-title'
  | 'translation-core'
  | 'full';

export interface PlaybackSearchPlanStage {
  reason: PlaybackSearchPlanStageReason;
  queries: string[];
  limit: number;
  directSearch: boolean;
  translationFallback?: boolean;
}

interface PlaybackSearchPlanOptions {
  title: string;
  searchTitle?: string;
  aliases?: string[];
  isBangumiCardSearch?: boolean;
  includeFastStage?: boolean;
}

export function deduplicateResults(list: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = `${item.source}_${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceIdentityKey(item: Pick<SearchResult, 'source' | 'id'>): string {
  return `${item.source}_${item.id}`;
}

/**
 * 背景搜尋結束時合併換源清單：正在播的源永遠放最前，
 * 不得被搜尋截止或標題過濾整份蓋掉。
 */
export function mergePlayingSourceIntoAvailableSources(
  searchResults: SearchResult[],
  playing: SearchResult | null | undefined,
  previous: SearchResult[] = []
): SearchResult[] {
  if (
    !playing ||
    !playing.source ||
    playing.id === undefined ||
    playing.id === null ||
    playing.id === ''
  ) {
    return deduplicateResults([...searchResults, ...previous]);
  }
  const playingKey = sourceIdentityKey(playing);
  const rest = deduplicateResults([...searchResults, ...previous]).filter(
    (item) => sourceIdentityKey(item) !== playingKey
  );
  return [playing, ...rest];
}

/** 類型文字是否為動漫／番劇（避免單字「漫」誤判浪漫等） */
export function isAnimeTypeText(typeText: string): boolean {
  return /動漫|动漫|動畫|动画|番劇|番剧|漫畫|漫画|新番|日番|OVA|OAD/i.test(
    typeText
  );
}

function typeTextOf(result: Pick<SearchResult, 'type_name' | 'class'>): string {
  return `${result.type_name || ''} ${result.class || ''}`.toLowerCase();
}

/**
 * 播放頁換源搜尋的類型過濾。搜尋快取會清掉播放網址，
 * 必須看 episode_count；沒有集數資訊時不要當電影丟掉。
 */
export function isPlaybackSourceTypeMatch(
  result: Pick<
    SearchResult,
    'episodes' | 'episode_count' | 'type_name' | 'class'
  >,
  searchType: string
): boolean {
  if (!searchType) return true;

  const episodeCount = getResultEpisodeCount(result);
  const typeText = typeTextOf(result);

  if (searchType === 'tv') {
    const isMovieKeyword =
      typeText.includes('電影') ||
      typeText.includes('电影') ||
      typeText.includes('影院') ||
      typeText.includes('片庫') ||
      typeText.includes('片库');
    const isTvKeyword =
      typeText.includes('劇') ||
      typeText.includes('剧') ||
      typeText.includes('季') ||
      typeText.includes('綜藝') ||
      typeText.includes('综艺') ||
      isAnimeTypeText(typeText) ||
      typeText.includes('番');
    if (isMovieKeyword && !isTvKeyword) return false;
    if (episodeCount > 1) return true;
    if (isTvKeyword && !isMovieKeyword) return true;
    if (episodeCount === 0) return true;
    return false;
  }

  if (searchType === 'movie') {
    const isMovieKeyword =
      typeText.includes('電影') ||
      typeText.includes('电影') ||
      typeText.includes('劇場版') ||
      typeText.includes('剧场版') ||
      typeText.includes('影院版');
    const isTvKeyword =
      typeText.includes('劇') ||
      typeText.includes('剧') ||
      typeText.includes('季');
    const isTheaterVersion =
      typeText.includes('劇場') ||
      typeText.includes('剧场') ||
      typeText.includes('影院');
    const realIsTv = isTvKeyword && !isTheaterVersion;
    if (isMovieKeyword && !realIsTv) return true;
    if (realIsTv) return false;
    if (episodeCount === 0) return true;
    return episodeCount === 1;
  }

  return true;
}

export function normalizeSearchTitleForSource(title: string): string {
  return toSearchSimplified((title || '').trim())
    .replace(SOURCE_TITLE_SEPARATOR_PATTERN, '')
    .trim();
}

function normalizeSearchTitleWithSpacesForSource(title: string): string {
  return toSearchSimplified((title || '').trim())
    .replace(SOURCE_TITLE_SEPARATOR_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTitleSegments(title: string): string[] {
  return toSearchSimplified((title || '').trim())
    .split(SOURCE_TITLE_SEPARATOR_PATTERN)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length >= 3 &&
        CJK_PATTERN.test(part) &&
        !/^第?\d+[季期部話话集]?$/.test(part)
    );
}

function getTitleSearchVariants(
  title?: string,
  options: { includeSegments?: boolean } = {}
): string[] {
  if (!title || !CJK_PATTERN.test(title) || KANA_PATTERN.test(title)) return [];
  return [
    normalizeSearchTitleForSource(title),
    normalizeSearchTitleWithSpacesForSource(title),
    toSearchSimplified(title).trim(),
    convertT2S(title).trim(),
    title,
    ...(options.includeSegments ? getTitleSegments(title) : []),
  ].filter(Boolean);
}

function normalizeSourceQueryCandidate(title: string): string {
  return normalizeMainlandChars(
    convertT2S(toSearchSimplified(cleanQueryForApi(title || '')))
  )
    .replace(/\bprat\s*(\d+)/gi, 'Part $1')
    .replace(/\bpt\s*(\d+)/gi, 'Part $1')
    .replace(TITLE_BRACKET_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMainlandChars(title: string): string {
  return title.replace(
    /[\u5f37\u8077\u696d\u8ce2\u6a23\u9451\u50de\u507d]/g,
    (char) => MAINLAND_CHAR_FIXES[char] || char
  );
}

function getMainlandCoreTitleQueries(title?: string): string[] {
  if (!title) return [];

  const normalized = normalizeSourceQueryCandidate(title);
  const compact = normalizeSearchTitleForSource(normalized);
  const withSpaces = normalizeSearchTitleWithSpacesForSource(normalized);
  const originalCompact = (title || '')
    .trim()
    .replace(SOURCE_TITLE_SEPARATOR_PATTERN, '')
    .trim();
  const season = extractSeason(normalized);
  const part = extractPart(normalized);
  const queries: string[] = [normalized, compact, originalCompact, withSpaces];

  const segments = normalized
    .replace(PARTICLE_SPLIT_PATTERN, ' ')
    .split(/[\s:：\-－—–|/]+/g)
    .map((segment) => normalizeSearchTitleForSource(segment))
    .filter((segment) => CJK_PATTERN.test(segment) && segment.length >= 2);

  const usefulSegments = segments.filter(
    (segment) => segment.length >= 3 && !WEAK_CORE_SEGMENTS.has(segment)
  );
  const firstUseful = usefulSegments[0];
  const lastUseful = usefulSegments[usefulSegments.length - 1];
  const seasonCore = normalized
    .replace(/\bpart\s*\d*/gi, ' ')
    .match(
      /([\u3400-\u9fff]{3,}?)(?:\u7b2c[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\d]+[\u5b63\u90e8]|\u7b2c\d+季)/
    )?.[1];
  const normalizedSeasonCore = seasonCore
    ? normalizeSearchTitleForSource(
        seasonCore.replace(LEADING_TITLE_NOISE_PATTERN, '')
      )
    : '';

  if (compact.length > 12 && lastUseful) {
    queries.unshift(lastUseful);
    if (firstUseful && firstUseful !== lastUseful) {
      queries.push(`${firstUseful}${lastUseful}`);
    }
  }

  if (normalizedSeasonCore) {
    if (season && part) {
      queries.unshift(`${normalizedSeasonCore}${season}Part${part}`);
    }
    if (part) queries.unshift(`${normalizedSeasonCore}Part${part}`);
    if (season) queries.unshift(`${normalizedSeasonCore}${season}`);
    queries.unshift(normalizedSeasonCore);
  }

  return Array.from(
    new Set(queries.map((query) => query.trim()).filter(isUsefulQuery))
  );
}

function isUsefulAliasForMatch(alias: string): boolean {
  const normalized = normalizeSearchTitleForSource(alias);
  if (!normalized) return false;
  if (KANA_PATTERN.test(alias) || KANA_PATTERN.test(normalized)) return false;
  return CJK_PATTERN.test(normalized) && normalized.length >= 4;
}

function isUsefulQuery(query: string): boolean {
  const normalized = normalizeSearchTitleForSource(query);
  if (!normalized) return false;
  if (KANA_PATTERN.test(query) || KANA_PATTERN.test(normalized)) return false;
  return CJK_PATTERN.test(normalized) && normalized.length >= 3;
}

/**
 * 站內搜尋計畫（getMainlandSearchQueries）允許 2 字陸名（高达、棋魂）。
 * 換源若沿用 isUsefulQuery（≥3），會把整段 regional 結果濾光，
 * 鋼彈／棋靈王變成 0 查詢。僅用於合併共用計畫時的放行門檻。
 */
function isUsefulSharedMainlandQuery(query: string): boolean {
  const normalized = normalizeSearchTitleForSource(query);
  if (!normalized) return false;
  if (KANA_PATTERN.test(query) || KANA_PATTERN.test(normalized)) return false;
  return CJK_PATTERN.test(normalized) && normalized.length >= 2;
}

function buildSearchQueryList(
  title: string,
  searchTitle?: string,
  aliases: string[] = [],
  options: {
    includeSegments?: boolean;
    searchTitleBeforeAliases?: boolean;
    filterAliasesForMatch?: boolean;
  } = {}
): string[] {
  const aliasList = options.filterAliasesForMatch
    ? aliases.filter(isUsefulAliasForMatch)
    : aliases;
  const titleVariants = getTitleSearchVariants(title, {
    includeSegments: options.includeSegments,
  });
  const searchTitleVariants = getTitleSearchVariants(searchTitle, {
    includeSegments: false,
  });
  const aliasVariants = aliasList.flatMap((alias) =>
    getTitleSearchVariants(alias, { includeSegments: false })
  );
  const ordered = options.searchTitleBeforeAliases
    ? [...titleVariants, ...searchTitleVariants, ...aliasVariants]
    : [...titleVariants, ...aliasVariants, ...searchTitleVariants];

  return Array.from(
    new Set(ordered.map((query) => query.trim()).filter(isUsefulQuery))
  );
}

export function getMatchQueries(
  title: string,
  searchTitle?: string,
  aliases: string[] = []
): Array<string | undefined> {
  return buildSearchQueryList(title, searchTitle, aliases, {
    filterAliasesForMatch: true,
  });
}

export function getStrictCardMatchQueries(
  title: string,
  searchTitle?: string,
  aliases: string[] = []
): string[] {
  return buildSearchQueryList(title, searchTitle, aliases, {
    filterAliasesForMatch: true,
  }).filter((query) => {
    if (KANA_PATTERN.test(query)) return false;
    const normalized = normalizeSearchTitleForSource(query);
    if (CJK_PATTERN.test(normalized)) return normalized.length >= 4;
    return normalized.length >= 6;
  });
}

export function getSourceSearchQueries(
  title: string,
  searchTitle?: string,
  aliases: string[] = []
): string[] {
  return buildSearchQueryList(title, searchTitle, aliases, {
    includeSegments: true,
  });
}

export function getFastSourceSearchQueries(
  title: string,
  searchTitle?: string
): string[] {
  const titleMainlandQueries = getMainlandCoreTitleQueries(title);
  const searchTitleMainlandQueries = CJK_PATTERN.test(title || '')
    ? []
    : getMainlandCoreTitleQueries(searchTitle);
  const mainlandQueries = [
    ...titleMainlandQueries,
    ...searchTitleMainlandQueries,
  ];
  if (mainlandQueries.length > 0) {
    return Array.from(new Set(mainlandQueries));
  }

  const titleVariants = getTitleSearchVariants(title, {
    includeSegments: false,
  });
  const titleHasCjk = CJK_PATTERN.test(title || '');
  const fastVariants = titleHasCjk
    ? titleVariants.filter((query) => CJK_PATTERN.test(query))
    : [
        ...titleVariants,
        ...getTitleSearchVariants(searchTitle, { includeSegments: false }),
      ];

  return Array.from(
    new Set(fastVariants.map((query) => query.trim()).filter(isUsefulQuery))
  );
}

export function getMainlandFallbackSourceSearchQueries(
  title: string,
  searchTitle?: string
): string[] {
  // 與 /api/search 同一張表、同一套計畫（OpenCC + regional），禁止另長第三套別名
  const sharedPlan: string[] = [];
  for (const base of [title, searchTitle]) {
    if (!base) continue;
    sharedPlan.push(...getMainlandSearchQueries(base));
  }
  const sharedQueries = sharedPlan
    .map((query) => query.trim())
    .filter(isUsefulSharedMainlandQuery);

  const legacyQueries = [
    ...getMainlandCoreTitleQueries(title),
    ...getMainlandCoreTitleQueries(searchTitle),
    ...getSourceSearchQueries(title, searchTitle),
  ]
    .map((query) => query.trim())
    .filter(isUsefulQuery);

  // 共用計畫優先（陸名先試），再接既有 core／full 變體
  return Array.from(new Set([...sharedQueries, ...legacyQueries]));
}

export function getChineseAliasSourceSearchQueries(
  aliases: string[]
): string[] {
  const aliasVariants = aliases
    .filter((alias) => CJK_PATTERN.test(alias) && !KANA_PATTERN.test(alias))
    .flatMap((alias) =>
      getTitleSearchVariants(alias, { includeSegments: false })
    )
    .filter((query) => CJK_PATTERN.test(query));

  return Array.from(
    new Set(aliasVariants.map((query) => query.trim()).filter(isUsefulQuery))
  );
}

function getTranslationComparableTitle(title: string): string {
  return normalizeSourceQueryCandidate(title)
    .replace(TRANSLATION_SEASON_MARKER_PATTERN, '')
    .replace(SOURCE_TITLE_SEPARATOR_PATTERN, '')
    .replace(/\d+$/g, '')
    .trim();
}

function getOrderedTranslationFragments(title: string): string[] {
  const comparable = getTranslationComparableTitle(title);
  const cjkRuns = comparable.match(/[\u3400-\u9fff]{3,}/g) || [];
  const fragments: string[] = [];

  for (const run of cjkRuns) {
    const windowSizes = run.length >= 7 ? [5, 4] : [4];
    const windows = windowSizes
      .filter((windowSize) => run.length >= windowSize)
      .map((windowSize) => {
        const lastStart = run.length - windowSize;
        return {
          windowSize,
          lastStart,
          centerStart: Math.floor(lastStart / 2),
        };
      });

    // Interleave long and short windows so the four-query budget does not
    // get exhausted by one window size before a useful shorter core is tried.
    for (const position of ['lastStart', 'centerStart', 'start'] as const) {
      for (const window of windows) {
        const start = position === 'start' ? 0 : window[position];
        fragments.push(run.slice(start, start + window.windowSize));
      }
    }

    // If both ends changed in translation, retain inner windows as later
    // candidates without allowing them to displace the preferred positions.
    const maxLastStart = Math.max(
      0,
      ...windows.map(({ lastStart }) => lastStart)
    );
    for (let start = 1; start < maxLastStart; start++) {
      for (const window of windows) {
        if (start < window.lastStart) {
          fragments.push(run.slice(start, start + window.windowSize));
        }
      }
    }
  }

  return Array.from(
    new Set(
      fragments
        .map((fragment) => normalizeSearchTitleForSource(fragment))
        .filter(
          (fragment) =>
            fragment.length >= 4 &&
            CJK_PATTERN.test(fragment) &&
            !TRANSLATION_WEAK_FRAGMENT_EDGE_PATTERN.test(fragment) &&
            !WEAK_CORE_SEGMENTS.has(fragment)
        )
    )
  );
}

export function getBangumiTranslationFallbackQueries(
  title: string,
  aliases: string[] = []
): string[] {
  const chineseTitles = [title, ...aliases].filter(
    (candidate) => CJK_PATTERN.test(candidate) && !KANA_PATTERN.test(candidate)
  );

  const fragmentGroups = chineseTitles.map(getOrderedTranslationFragments);
  const queries: string[] = [];
  const seen = new Set<string>();
  const addQuery = (query?: string) => {
    if (
      !query ||
      seen.has(query) ||
      queries.length >= TRANSLATION_FALLBACK_MAX_QUERIES
    ) {
      return;
    }
    seen.add(query);
    queries.push(query);
  };

  // Reserve two high-value slots for the displayed Bangumi title.
  addQuery(fragmentGroups[0]?.[0]);
  addQuery(fragmentGroups[0]?.[1]);

  // Give each Chinese alias a chance before filling the remaining slots.
  for (let groupIndex = 1; groupIndex < fragmentGroups.length; groupIndex++) {
    addQuery(fragmentGroups[groupIndex][0]);
  }

  const cursors = fragmentGroups.map((_, index) => (index === 0 ? 2 : 1));
  while (queries.length < TRANSLATION_FALLBACK_MAX_QUERIES) {
    let advanced = false;
    for (let groupIndex = 0; groupIndex < fragmentGroups.length; groupIndex++) {
      const group = fragmentGroups[groupIndex];
      const cursor = cursors[groupIndex];
      if (cursor >= group.length) continue;
      cursors[groupIndex] += 1;
      addQuery(group[cursor]);
      advanced = true;
      if (queries.length >= TRANSLATION_FALLBACK_MAX_QUERIES) break;
    }
    if (!advanced) break;
  }

  return queries;
}

function getSpecialTitleMarkers(title: string): string[] {
  return Array.from(
    new Set(
      (toSearchSimplified(title).match(TRANSLATION_SPECIAL_PATTERN) || []).map(
        (marker) => marker.toLowerCase()
      )
    )
  );
}

export function isBangumiTranslationFallbackMatch(
  candidateTitle: string,
  searchedFragment: string,
  referenceTitles: string[]
): boolean {
  const candidateComparable = getTranslationComparableTitle(candidateTitle);
  const fragment = normalizeSearchTitleForSource(searchedFragment);
  if (
    !candidateComparable ||
    fragment.length < 4 ||
    !candidateComparable.includes(fragment)
  ) {
    return false;
  }

  return referenceTitles.some((referenceTitle) => {
    if (!referenceTitle || !CJK_PATTERN.test(referenceTitle)) return false;

    const referenceComparable = getTranslationComparableTitle(referenceTitle);
    if (!referenceComparable.includes(fragment)) return false;

    const targetSeason = extractSeason(referenceTitle);
    const candidateSeason = extractSeason(candidateTitle);
    if (
      targetSeason !== null &&
      candidateSeason !== null &&
      targetSeason !== candidateSeason
    ) {
      return false;
    }
    if (targetSeason !== null && targetSeason > 1 && candidateSeason === null) {
      return false;
    }

    const targetPart = extractPart(referenceTitle);
    const candidatePart = extractPart(candidateTitle);
    if (
      targetPart !== null &&
      candidatePart !== null &&
      targetPart !== candidatePart
    ) {
      return false;
    }

    const referenceSpecials = getSpecialTitleMarkers(referenceTitle);
    const candidateSpecials = getSpecialTitleMarkers(candidateTitle);
    if (
      candidateSpecials.some((marker) => !referenceSpecials.includes(marker))
    ) {
      return false;
    }

    if (isFuzzyMatch(candidateTitle, referenceTitle)) return true;

    const shorterLength = Math.min(
      referenceComparable.length,
      candidateComparable.length
    );
    const longerLength = Math.max(
      referenceComparable.length,
      candidateComparable.length
    );
    if (!shorterLength || !longerLength) return false;

    const sharedCoverage = fragment.length / shorterLength;
    const lengthRatio = shorterLength / longerLength;
    return sharedCoverage >= 0.45 && lengthRatio >= 0.6;
  });
}

export function buildPlaybackSearchPlan({
  title,
  searchTitle,
  aliases = [],
  isBangumiCardSearch = false,
  includeFastStage = true,
}: PlaybackSearchPlanOptions): PlaybackSearchPlanStage[] {
  const stages: PlaybackSearchPlanStage[] = [];

  // fast：原字串優先；mainland：與站內搜尋共用陸名計畫（含 regional）
  // mainland 不綁 includeFastStage——播放頁已有源時會關掉 fast，仍必須能換源
  if (includeFastStage) {
    stages.push({
      reason: 'fast',
      queries: getFastSourceSearchQueries(title, searchTitle),
      limit: 3,
      directSearch: true,
    });
  }
  stages.push({
    reason: 'mainland',
    queries: getMainlandFallbackSourceSearchQueries(title, searchTitle),
    limit: 3,
    directSearch: true,
  });

  if (isBangumiCardSearch) {
    if (includeFastStage && aliases.length === 0) {
      return stages.filter(
        (stage) => stage.queries.length > 0 && stage.limit > 0
      );
    }

    if (aliases.length > 0) {
      stages.push({
        reason: 'bangumi-alias',
        queries: getChineseAliasSourceSearchQueries(aliases),
        limit: 3,
        directSearch: true,
      });
    }
    stages.push({
      reason: 'search-title',
      queries: searchTitle ? getFastSourceSearchQueries('', searchTitle) : [],
      limit: 2,
      directSearch: true,
    });
    stages.push({
      reason: 'full',
      queries: getSourceSearchQueries(title, searchTitle, aliases),
      limit: 4,
      directSearch: true,
    });
    stages.push({
      reason: 'translation-core',
      queries: getBangumiTranslationFallbackQueries(title, aliases),
      limit: TRANSLATION_FALLBACK_MAX_QUERIES,
      directSearch: true,
      translationFallback: true,
    });
  } else {
    stages.push({
      reason: 'full',
      queries: getSourceSearchQueries(title, searchTitle),
      limit: 4,
      directSearch: true,
    });
  }

  return stages.filter((stage) => stage.queries.length > 0 && stage.limit > 0);
}

export function isStrictCardTitleMatch(
  title: string,
  queries: Array<string | undefined | null>
): boolean {
  const normalizedTitle = normalizeSearchTitleForSource(title);
  if (!normalizedTitle) return false;

  return queries.some((query) => {
    if (!query) return false;
    return normalizedTitle === normalizeSearchTitleForSource(query);
  });
}

export function sortByTitleMatch(
  list: SearchResult[],
  queries: Array<string | undefined | null>
): SearchResult[] {
  return [...list].sort(
    (a, b) =>
      getBestTitleMatchScore(b.title, queries) -
      getBestTitleMatchScore(a.title, queries)
  );
}

export async function fetchBangumiSearchAliases(
  bangumiId: string
): Promise<string[]> {
  if (!bangumiId) return [];

  try {
    const params = new URLSearchParams({ id: bangumiId });
    const response = await fetch(`/api/bangumi/aliases?${params.toString()}`);
    if (!response.ok) return [];

    const data = (await response.json()) as { aliases?: string[] };
    return normalizeAliasList(data.aliases || []);
  } catch (error) {
    logger.warn('Fetch Bangumi aliases failed:', error);
    return [];
  }
}
