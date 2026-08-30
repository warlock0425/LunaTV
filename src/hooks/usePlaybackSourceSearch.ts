import { MutableRefObject, useCallback, useRef, useState } from 'react';

import { logger } from '@/lib/logger';
import {
  filterTitleSafeCandidates,
  isPreferredDisplayQuality,
  pickSpeedTestEpisodeUrl,
  selectSourceAfterSpeedTests,
  VideoTestResult,
} from '@/lib/play-page-utils';
import {
  deduplicateResults,
  getMatchQueries,
  getStrictCardMatchQueries,
  isAnimeTypeText,
  isBangumiTranslationFallbackMatch,
  isPlaybackSourceTypeMatch,
  isStrictCardTitleMatch,
  sortByTitleMatch,
} from '@/lib/play-search';
import { getBestTitleMatchScore, isFuzzyMatch } from '@/lib/searchEngine';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';

const SPEED_TEST_CACHE_TTL_MS = 30 * 60 * 1000;

export type PreferBestSourceResult = {
  source: SearchResult;
  /** 全部測完後標題安全組內仍無 1080p+，已退回現行評分 */
  noHighQualityNotice?: boolean;
};

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

  /**
   * 播放源優選：
   * 1) 先算標題分、取標題安全組（不可顛倒）
   * 2) 組內測速，命中第一個 1080p+ 即回傳起播，其餘背景繼續測
   * 3) 全部測完仍無 1080p+ → 退回評分選最好的，並標記提示
   * 4) 全部測速失敗 → sources[0]
   */
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<PreferBestSourceResult> => {
    if (sources.length === 0) {
      throw new Error('preferBestSource requires at least one source');
    }
    if (sources.length === 1) {
      return { source: sources[0] };
    }

    const matchQueries = getMatchQueries(
      initialVideoTitleRef.current,
      searchTitle
    );

    // 標題分不需網路；先分組再測速，避免錯片 1080p 搶先
    const titled = sources.map((source) => ({
      source,
      titleScore: getBestTitleMatchScore(source.title, matchQueries),
    }));
    const titleSafe = filterTitleSafeCandidates(titled);
    const toTest = titleSafe.length > 0 ? titleSafe : titled;

    const signal = abortActiveSpeedTests();
    const successful: Array<{
      source: SearchResult;
      testResult: VideoTestResult;
      titleScore: number;
    }> = [];
    const testedKeys = new Set<string>();

    const mergeInfo = (sourceKey: string, testResult: VideoTestResult) => {
      setPrecomputedVideoInfo((prev) => {
        const next = new Map(prev);
        next.set(sourceKey, testResult);
        return next;
      });
    };

    const testOne = async (item: {
      source: SearchResult;
      titleScore: number;
    }): Promise<{
      source: SearchResult;
      testResult: VideoTestResult;
      titleScore: number;
    } | null> => {
      const sourceKey = `${item.source.source}-${item.source.id}`;
      try {
        if (signal.aborted) return null;

        const episodeUrl = pickSpeedTestEpisodeUrl(item.source.episodes);
        if (!episodeUrl) {
          logger.warn(`播放源 ${item.source.source_name} 沒有可用的播放地址`);
          return null;
        }
        const testResult = await getCachedVideoTestResult(episodeUrl, signal);
        testedKeys.add(sourceKey);
        mergeInfo(sourceKey, testResult);
        return {
          source: item.source,
          testResult,
          titleScore: item.titleScore,
        };
      } catch {
        return null;
      }
    };

    // 併發 3：任一標題安全組內的 1080p+ 完成即起播
    // 用物件承載，避免 async worker 賦值後 TS 仍把 outer let 收窄成 never
    const earlyHd = { source: null as SearchResult | null };
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(3, toTest.length) },
      async () => {
        while (
          nextIndex < toTest.length &&
          !earlyHd.source &&
          !signal.aborted
        ) {
          const current = toTest[nextIndex++];
          const result = await testOne(current);
          if (!result) continue;
          successful.push(result);
          if (isPreferredDisplayQuality(result.testResult.quality)) {
            earlyHd.source = result.source;
            return;
          }
        }
      }
    );
    await Promise.all(workers);

    if (earlyHd.source) {
      // 其餘源背景測完只更新換源列表，不打斷播放、不 abort
      const remaining = sources.filter(
        (s) => !testedKeys.has(`${s.source}-${s.id}`)
      );
      if (remaining.length > 0) {
        void runWithConcurrency(remaining, 3, async (source) => {
          await runSpeedTestForSource(source, signal);
        });
      }
      logger.debug(
        `首播命中 1080p+：${earlyHd.source.source_name}（其餘 ${remaining.length} 個背景測速）`
      );
      return { source: earlyHd.source };
    }

    if (successful.length === 0) {
      logger.warn('所有播放源測速都失敗，使用第一個播放源');
      // 背景仍試著補測，方便換源列表
      void runWithConcurrency(sources, 3, async (source) => {
        await runSpeedTestForSource(source, signal);
      });
      return { source: sources[0] };
    }

    const picked = selectSourceAfterSpeedTests(successful);
    if (!picked) {
      return { source: sources[0] };
    }

    // 未測完的也背景補測
    const remaining = sources.filter(
      (s) => !testedKeys.has(`${s.source}-${s.id}`)
    );
    if (remaining.length > 0) {
      void runWithConcurrency(remaining, 3, async (source) => {
        await runSpeedTestForSource(source, signal);
      });
    }

    if (picked.fellBackWithoutHd) {
      logger.debug('標題安全組內無 1080p+，退回評分選源');
    }

    return {
      source: picked.source,
      noHighQualityNotice: picked.fellBackWithoutHd,
    };
  };

  // 計算播放源綜合評分

  const runSpeedTestForSource = async (
    res: SearchResult,
    signal?: AbortSignal
  ) => {
    const key = `${res.source}-${res.id}`;
    if (speedTestedKeys.current.has(key)) return;
    // 進行中就先佔位，避免同一輪重複測速
    speedTestedKeys.current.add(key);

    try {
      // 與換源列表同一規則：見 pickSpeedTestEpisodeUrl
      const episodeUrl = pickSpeedTestEpisodeUrl(res.episodes);
      if (!episodeUrl) {
        speedTestedKeys.current.delete(key);
        return;
      }

      const testResult = await getCachedVideoTestResult(episodeUrl, signal);
      setPrecomputedVideoInfo((prev) => {
        const next = new Map(prev);
        next.set(key, testResult);
        return next;
      });
    } catch (e) {
      // 測速失敗或被中止時務必把佔位移除，否則這個源會被永久標記成
      // 「已測過」卻沒有任何結果——之後每一輪都會 early return，
      // 選集面板上它的畫質／速度會一直空著。preferBestSource 開新一輪、
      // 或卸載時 abort 都會走到這條路徑。
      speedTestedKeys.current.delete(key);
      logger.warn(`Speed test failed for ${res.source_name}:`, e);
    }
  };

  const fetchSourcesData = async (
    query: string,
    onProgress?: (results: SearchResult[]) => void,
    options: {
      strictCardMatch?: boolean;
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

        const typeMatch = isPlaybackSourceTypeMatch(result, searchType);

        return titlesMatch && yearsMatch && typeMatch;
      });

      const deduplicated = deduplicateResults(matchedResults);

      if (onProgress && deduplicated.length > 0) {
        onProgress(deduplicated);
      }

      // 測速只由 preferBestSource 驅動（含命中即起播後的背景補測）。
      // 此處不得 abort／開第二條測速路徑，否則會掐掉首播 1080p 閘門。
      const sorted = sortByTitleMatch(deduplicated, matchQueries);
      return sorted;
    } catch (err) {
      logger.error('取得播放源失敗:', err);
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
