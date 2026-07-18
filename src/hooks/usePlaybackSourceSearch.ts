import { MutableRefObject, useCallback, useRef, useState } from 'react';

import { logger } from '@/lib/logger';
import { calculateSourceScore, VideoTestResult } from '@/lib/play-page-utils';
import {
  deduplicateResults,
  getMatchQueries,
  getStrictCardMatchQueries,
  isBangumiTranslationFallbackMatch,
  isStrictCardTitleMatch,
  sortByTitleMatch,
} from '@/lib/play-search';
import { getBestTitleMatchScore, isFuzzyMatch } from '@/lib/searchEngine';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';

const SPEED_TEST_CACHE_TTL_MS = 30 * 60 * 1000;

/** 類型文字是否為動漫／番劇（避免單字「漫」誤判浪漫等） */
function isAnimeTypeText(typeText: string): boolean {
  return /動漫|动漫|動畫|动画|番劇|番剧|漫畫|漫画|新番|日番|OVA|OAD/i.test(
    typeText
  );
}

type UsePlaybackSourceSearchOptions = {
  initialVideoTitleRef: MutableRefObject<string>;
  initialVideoYearRef: MutableRefObject<string>;
  videoYearRef: MutableRefObject<string>;
  bangumiSearchAliasesRef: MutableRefObject<string[]>;
  searchTitle: string;
  searchType: string;
};

export function usePlaybackSourceSearch({
  initialVideoTitleRef,
  initialVideoYearRef,
  videoYearRef,
  bangumiSearchAliasesRef,
  searchTitle,
  searchType,
}: UsePlaybackSourceSearchOptions) {
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());
  const speedTestedKeys = useRef<Set<string>>(new Set());
  const speedTestCacheRef = useRef<
    Map<string, { expiresAt: number; result: VideoTestResult }>
  >(new Map());
  const speedTestAbortControllerRef = useRef<AbortController | null>(null);

  const abortActiveSpeedTests = useCallback(() => {
    if (speedTestAbortControllerRef.current) {
      speedTestAbortControllerRef.current.abort();
    }
    const newController = new AbortController();
    speedTestAbortControllerRef.current = newController;
    return newController.signal;
  }, []);

  const runWithConcurrency = async <T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>
  ): Promise<R[]> => {
    const results: R[] = [];
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        try {
          results[currentIndex] = await fn(items[currentIndex]);
        } catch {
          // 確保個別錯誤不影響整體流程
        }
      }
    };
    const workers = Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker()
    );
    await Promise.all(workers);
    return results;
  };

  const getCachedVideoTestResult = async (
    episodeUrl: string,
    signal?: AbortSignal
  ): Promise<VideoTestResult> => {
    const cached = speedTestCacheRef.current.get(episodeUrl);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }
    if (cached) {
      speedTestCacheRef.current.delete(episodeUrl);
    }

    const result = await getVideoResolutionFromM3u8(episodeUrl, signal);
    speedTestCacheRef.current.set(episodeUrl, {
      expiresAt: now + SPEED_TEST_CACHE_TTL_MS,
      result,
    });
    return result;
  };

  // 播放源優選函數
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    const signal = abortActiveSpeedTests();

    // 限制併發數為 3 進行分批測速
    const allResults = await runWithConcurrency(sources, 3, async (source) => {
      try {
        if (!source.episodes || source.episodes.length === 0) {
          logger.warn(`播放源 ${source.source_name} 沒有可用的播放地址`);
          return null;
        }

        const episodeUrl = source.episodes[0];
        const testResult = await getCachedVideoTestResult(episodeUrl, signal);

        return {
          source,
          testResult,
        };
      } catch (error) {
        return null;
      }
    });

    // 等待所有測速完成，包含成功和失敗的結果
    // 儲存所有測速結果到 precomputedVideoInfo，供 EpisodeSelector 使用（包含錯誤結果）
    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
      }
    >();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${source.source}-${source.id}`;

      if (result) {
        // 成功的結果
        newVideoInfoMap.set(sourceKey, result.testResult);
      }
    });

    // 過濾出成功的結果用於優選計算
    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) {
      logger.warn('所有播放源測速都失敗，使用第一個播放源');
      return sources[0];
    }

    // 找出所有有效速度的最大值，用於線性映射
    const validSpeeds = successfulResults
      .map((result) => {
        const speedStr = result.testResult.loadSpeed;
        if (speedStr === '未知' || speedStr === '測量中...') return 0;

        const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2];
        return unit === 'MB/s' ? value * 1024 : value; // 統一轉換為 KB/s
      })
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024; // 預設1MB/s作為基準

    // 找出所有有效延遲的最小值和最大值，用於線性映射
    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    const matchQueries = getMatchQueries(
      initialVideoTitleRef.current,
      searchTitle
    );

    // 計算每個結果的評分，標題精準度優先於測速，避免錯誤片源因速度快被選中。
    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      titleScore: getBestTitleMatchScore(result.source.title, matchQueries),
      sourceScore: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }));

    const maxTitleScore = Math.max(
      ...resultsWithScore.map((result) => result.titleScore)
    );
    const titleSafeResults = resultsWithScore.filter(
      (result) => result.titleScore >= maxTitleScore - 80
    );

    // 按標題精準度分組後，再按綜合測速評分排序，選擇最佳播放源
    titleSafeResults.sort((a, b) => b.sourceScore - a.sourceScore);

    logger.debug('播放源評分排序結果:');
    titleSafeResults.forEach((result, index) => {
      logger.debug(
        `${index + 1}. ${result.source.source_name} - 標題: ${
          result.titleScore
        }, 測速: ${result.sourceScore.toFixed(2)} (${
          result.testResult.quality
        }, ${result.testResult.loadSpeed}, ${result.testResult.pingTime}ms)`
      );
    });

    return titleSafeResults[0]?.source || resultsWithScore[0].source;
  };

  // 計算播放源綜合評分

  const runSpeedTestForSource = async (
    res: SearchResult,
    signal?: AbortSignal
  ) => {
    try {
      const key = `${res.source}-${res.id}`;
      if (speedTestedKeys.current.has(key)) return;
      speedTestedKeys.current.add(key);

      const episodeUrl =
        res.episodes.length > 1
          ? res.episodes[res.episodes.length - 1]
          : res.episodes[0];
      if (!episodeUrl) return;

      const testResult = await getCachedVideoTestResult(episodeUrl, signal);
      setPrecomputedVideoInfo((prev) => {
        const next = new Map(prev);
        next.set(key, testResult);
        return next;
      });
    } catch (e) {
      logger.warn(`Speed test failed for ${res.source_name}:`, e);
    }
  };

  const fetchSourcesData = async (
    query: string,
    onProgress?: (results: SearchResult[]) => void,
    options: {
      strictCardMatch?: boolean;
      speedTest?: boolean;
      directSearch?: boolean;
      translationFallback?: boolean;
    } = {}
  ): Promise<SearchResult[]> => {
    try {
      const cleanedQuery = query.trim();
      if (!cleanedQuery) return [];
      const params = new URLSearchParams({ q: cleanedQuery });
      if (options.directSearch !== false) {
        params.set('mode', 'direct');
      }
      const url = `/api/search?${params.toString()}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const rawResults = (data.results || []) as SearchResult[];

      const matchQueries = options.strictCardMatch
        ? getStrictCardMatchQueries(
            initialVideoTitleRef.current,
            searchTitle,
            bangumiSearchAliasesRef.current
          )
        : getMatchQueries(
            initialVideoTitleRef.current,
            searchTitle,
            bangumiSearchAliasesRef.current
          );

      const matchedResults = rawResults.filter((result: SearchResult) => {
        const translationFallbackMatch = options.translationFallback
          ? isBangumiTranslationFallbackMatch(result.title, query, [
              initialVideoTitleRef.current,
              ...bangumiSearchAliasesRef.current,
            ])
          : false;
        const titlesMatch = options.strictCardMatch
          ? isStrictCardTitleMatch(result.title, matchQueries) ||
            isFuzzyMatch(result.title, initialVideoTitleRef.current) ||
            translationFallbackMatch
          : getBestTitleMatchScore(result.title, matchQueries) > 0 ||
            (searchTitle ? isFuzzyMatch(result.title, searchTitle) : false);

        // 比較年份
        let yearsMatch = true;
        const targetYear = initialVideoYearRef.current || videoYearRef.current;
        if (targetYear && result.year) {
          const vYearMatch = targetYear.match(/\d{4}/);
          const rYearMatch = result.year.match(/\d{4}/);
          const vYear = vYearMatch ? vYearMatch[0] : '';
          const rYear = rYearMatch ? rYearMatch[0] : '';
          if (vYear && rYear && rYear !== '0') {
            const vNum = parseInt(vYear, 10);
            const rNum = parseInt(rYear, 10);
            if (!isNaN(vNum) && !isNaN(rNum)) {
              const typeName = (result.type_name || '').toLowerCase();
              const className = (result.class || '').toLowerCase();
              const typeText = `${typeName} ${className}`;
              const isAnime = isAnimeTypeText(typeText);

              const maxDiff = isAnime ? 10 : 1;
              yearsMatch = Math.abs(vNum - rNum) <= maxDiff;
            }
          }
        }

        // 類型匹配
        let typeMatch = true;
        if (searchType) {
          const typeName = (result.type_name || '').toLowerCase();
          const className = (result.class || '').toLowerCase();
          const typeText = `${typeName} ${className}`;
          if (searchType === 'tv') {
            const isMovieKeyword =
              typeText.includes('電影') ||
              typeText.includes('\u7535\u5f71') || // 电影
              typeText.includes('影院') ||
              typeText.includes('片庫') ||
              typeText.includes('\u7247\u5e93'); // 片库
            const isTvKeyword =
              typeText.includes('劇') ||
              typeText.includes('\u5267') || // 剧
              typeText.includes('季') ||
              typeText.includes('綜藝') ||
              typeText.includes('\u7efc\u827a') || // 综艺
              isAnimeTypeText(typeText) ||
              typeText.includes('番');
            typeMatch =
              result.episodes.length > 1 || (isTvKeyword && !isMovieKeyword);
          } else if (searchType === 'movie') {
            const isMovieKeyword =
              typeText.includes('電影') ||
              typeText.includes('\u7535\u5f71') || // 电影
              typeText.includes('劇場版') ||
              typeText.includes('\u5267\u573a\u7248') || // 剧场版
              typeText.includes('影院版');
            const isTvKeyword =
              typeText.includes('劇') ||
              typeText.includes('\u5267') || // 剧
              typeText.includes('季');
            const isTheaterVersion =
              typeText.includes('劇場') ||
              typeText.includes('\u5267\u573a') || // 剧场
              typeText.includes('影院');
            const realIsTv = isTvKeyword && !isTheaterVersion;
            if (isMovieKeyword && !realIsTv) {
              typeMatch = true;
            } else if (realIsTv) {
              typeMatch = false;
            } else {
              typeMatch = result.episodes.length === 1;
            }
          }
        }

        return titlesMatch && yearsMatch && typeMatch;
      });

      const deduplicated = deduplicateResults(matchedResults);

      if (onProgress && deduplicated.length > 0) {
        onProgress(deduplicated);
      }

      if (options.speedTest !== false) {
        // 背景限制併發數為 3 分批測速
        const signal = abortActiveSpeedTests();
        runWithConcurrency(deduplicated, 3, async (res: SearchResult) => {
          await runSpeedTestForSource(res, signal);
        });
      }

      const sorted = sortByTitleMatch(deduplicated, matchQueries);
      return sorted;
    } catch (err) {
      logger.error('獲取播放源失敗:', err);
      return [];
    }
  };

  return {
    availableSources,
    setAvailableSources,
    sourceSearchLoading,
    setSourceSearchLoading,
    sourceSearchError,
    setSourceSearchError,
    precomputedVideoInfo,
    preferBestSource,
    fetchSourcesData,
    abortActiveSpeedTests,
  };
}
