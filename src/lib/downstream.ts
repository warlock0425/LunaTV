/* eslint-disable @typescript-eslint/no-explicit-any */
import { API_CONFIG, ApiSite, getConfig } from '@/lib/config';
import { getCachedSearchPage, setCachedSearchPage } from '@/lib/search-cache';
import { SearchResult } from '@/lib/types';
import { fetchSafeRemoteUrl } from '@/lib/url-safety';
import { cleanHtmlTags } from '@/lib/utils';

import { toSearchSimplified } from './chinese';
import { getMainlandSearchQueries } from './mainland-search';
import { deduplicateRequest } from './request-dedupe';
import { isFuzzyMatch } from './searchEngine';
import {
  isSourceTripped,
  recordSourceFailure,
  recordSourceSuccess,
} from './source-circuit-breaker';

interface ApiSearchItem {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

function localizeSearchResult(result: SearchResult): SearchResult {
  return result;
}

/** m3u8 連結判斷：容許帶查詢參數（如 xxx.m3u8?sign=...） */
function isM3u8Link(url: string): boolean {
  return /\.m3u8($|\?)/i.test(url);
}

function normalizeVariantsForUpstream(variants: string[]): string[] {
  return Array.from(
    new Set(
      variants
        .map((variant) => toSearchSimplified(variant).trim())
        .filter((variant) => variant.length > 0)
    )
  );
}

async function searchWithCache(
  apiSite: ApiSite,
  query: string,
  page: number,
  url: string,
  timeoutMs = 4000,
  parentSignal?: AbortSignal
): Promise<{ results: SearchResult[]; pageCount?: number }> {
  const cached = getCachedSearchPage(apiSite.key, query, page);
  if (cached) {
    return cached.status === 'ok'
      ? { results: cached.data, pageCount: cached.pageCount }
      : { results: [] };
  }

  // 源級熔斷：連續逾時的死源在冷卻期內直接跳過，避免拖慢整體搜尋
  if (isSourceTripped(apiSite.key)) {
    return { results: [] };
  }

  const cacheKey = `${apiSite.key}::${query}::${page}`;
  return deduplicateRequest(cacheKey, async () => {
    const controller = new AbortController();
    let timedOut = false;
    const abortFromParent = () => controller.abort();
    if (parentSignal?.aborted) {
      controller.abort();
    } else {
      parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    }
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchSafeRemoteUrl(url, {
        headers: API_CONFIG.search.headers,
        signal: controller.signal,
      });
      // 有收到 HTTP 回應即代表來源存活，重置熔斷計數
      recordSourceSuccess(apiSite.key);
      if (!response.ok) {
        if (response.status === 403)
          setCachedSearchPage(apiSite.key, query, page, 'forbidden', []);
        return { results: [] };
      }
      const data = await response.json();
      if (
        !data ||
        !data.list ||
        !Array.isArray(data.list) ||
        data.list.length === 0
      ) {
        return { results: [] };
      }
      const allResults = data.list.map((item: ApiSearchItem) => {
        let episodes: string[] = [];
        let titles: string[] = [];
        if (item.vod_play_url) {
          item.vod_play_url.split('$$$').forEach((url: string) => {
            const matchEpisodes: string[] = [];
            const matchTitles: string[] = [];
            url.split('#').forEach((title_url: string) => {
              const episode_title_url = title_url.split('$');
              if (
                episode_title_url.length === 2 &&
                isM3u8Link(episode_title_url[1])
              ) {
                matchTitles.push(episode_title_url[0]);
                matchEpisodes.push(episode_title_url[1]);
              }
            });
            if (matchEpisodes.length > episodes.length) {
              episodes = matchEpisodes;
              titles = matchTitles;
            }
          });
        }
        return {
          id: item.vod_id.toString(),
          title: item.vod_name.trim().replace(/\s+/g, ' '),
          poster: item.vod_pic,
          episodes,
          episodes_titles: titles,
          source: apiSite.key,
          source_name: apiSite.name,
          class: item.vod_class,
          year: item.vod_year
            ? item.vod_year.match(/\d{4}/)?.[0] || ''
            : 'unknown',
          desc: cleanHtmlTags(item.vod_content || ''),
          type_name: item.type_name,
          douban_id: item.vod_douban_id,
        };
      });
      const results = allResults.filter(
        (r: SearchResult) => r.episodes.length > 0
      );
      const pageCount = page === 1 ? data.pagecount || 1 : undefined;
      setCachedSearchPage(apiSite.key, query, page, 'ok', results, pageCount);
      return { results, pageCount };
    } catch (error: any) {
      if (timedOut && (error?.name === 'AbortError' || error?.code === 20)) {
        setCachedSearchPage(apiSite.key, query, page, 'timeout', []);
        recordSourceFailure(apiSite.key);
      } else if (error?.name !== 'AbortError') {
        // 連線失敗（DNS 解析失敗、拒絕連線等）也計入熔斷；
        // 呼叫端主動中止（AbortError 且非逾時）不計
        recordSourceFailure(apiSite.key);
      }
      return { results: [] };
    } finally {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  });
}

export async function searchFromApi(
  apiSite: ApiSite,
  query: string,
  precomputedVariants?: string[],
  signal?: AbortSignal
): Promise<SearchResult[]> {
  try {
    const apiBaseUrl = apiSite.api;
    const plannedVariants =
      precomputedVariants && precomputedVariants.length > 0
        ? precomputedVariants
        : getMainlandSearchQueries(query);
    const searchVariants = normalizeVariantsForUpstream(
      plannedVariants.length > 0 ? plannedVariants : [query]
    );
    const variantResults: Array<{
      variant: string;
      index: number;
      results: SearchResult[];
      pageCount?: number;
    }> = [];
    let firstNonEmptyResult:
      | {
          variant: string;
          index: number;
          results: SearchResult[];
          pageCount?: number;
        }
      | undefined;
    for (let index = 0; index < searchVariants.length; index++) {
      if (signal?.aborted) return [];
      const variant = searchVariants[index];
      const apiUrl =
        apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(variant);
      const result = await searchWithCache(
        apiSite,
        variant,
        1,
        apiUrl,
        4000,
        signal
      );
      if (result.results.length > 0) {
        const candidate = {
          variant,
          index,
          results: result.results,
          pageCount: result.pageCount,
        };
        firstNonEmptyResult ||= candidate;
        if (result.results.some((item) => isFuzzyMatch(item.title, variant))) {
          variantResults.push(candidate);
          break;
        }
      }
    }
    if (variantResults.length === 0 && firstNonEmptyResult) {
      variantResults.push(firstNonEmptyResult);
    }
    const seenIds = new Set<string>();
    const results: SearchResult[] = [];
    let pageCountToFetch = 0;
    let successfulVariant = query;
    for (const { results: variantData, pageCount, variant } of variantResults) {
      if (variantData.length > 0) {
        if (!pageCountToFetch && pageCount) {
          pageCountToFetch = pageCount;
          successfulVariant = variant;
        }
        variantData.forEach((result) => {
          const uniqueKey = `${result.source}_${result.id}`;
          if (!seenIds.has(uniqueKey)) {
            seenIds.add(uniqueKey);
            results.push(localizeSearchResult(result));
          }
        });
      }
    }
    if (results.length === 0) return [];
    const config = await getConfig();
    const MAX_SEARCH_PAGES: number = config.SiteConfig.SearchDownstreamMaxPage;
    const pageCount = pageCountToFetch || 1;
    const pagesToFetch = Math.min(pageCount - 1, MAX_SEARCH_PAGES - 1);
    if (pagesToFetch > 0) {
      const additionalPagePromises = [];
      for (let page = 2; page <= pagesToFetch + 1; page++) {
        if (signal?.aborted) break;
        const pageUrl =
          apiBaseUrl +
          API_CONFIG.search.pagePath
            .replace('{query}', encodeURIComponent(successfulVariant))
            .replace('{page}', page.toString());
        const pagePromise = (async () => {
          const pageResult = await searchWithCache(
            apiSite,
            successfulVariant,
            page,
            pageUrl,
            4000,
            signal
          );
          return pageResult.results;
        })();
        additionalPagePromises.push(pagePromise);
      }
      const additionalResults = await Promise.all(additionalPagePromises);
      additionalResults.forEach((pageResults) => {
        if (pageResults.length > 0) {
          pageResults.forEach((result) => {
            const uniqueKey = `${result.source}_${result.id}`;
            if (!seenIds.has(uniqueKey)) {
              seenIds.add(uniqueKey);
              results.push(localizeSearchResult(result));
            }
          });
        }
      });
    }
    return results;
  } catch (error) {
    return [];
  }
}

const M3U8_PATTERN = /(https?:\/\/[^"'\s]+?\.m3u8)/g;

export async function getDetailFromApi(
  apiSite: ApiSite,
  id: string
): Promise<SearchResult> {
  if (apiSite.detail) {
    return handleSpecialSourceDetail(id, apiSite);
  }
  const detailUrl = `${apiSite.api}${API_CONFIG.detail.path}${id}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  const response = await fetchSafeRemoteUrl(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  });
  if (!response.ok) {
    clearTimeout(timeoutId);
    throw new Error(`詳情請求失敗: ${response.status}`);
  }
  const data = await response.json();
  clearTimeout(timeoutId);
  if (
    !data ||
    !data.list ||
    !Array.isArray(data.list) ||
    data.list.length === 0
  ) {
    throw new Error('獲取到的詳情內容無效');
  }
  const videoDetail = data.list[0];
  let episodes: string[] = [];
  let titles: string[] = [];
  if (videoDetail.vod_play_url) {
    const vod_play_url_array = videoDetail.vod_play_url.split('$$$');
    vod_play_url_array.forEach((url: string) => {
      const matchEpisodes: string[] = [];
      const matchTitles: string[] = [];
      const title_url_array = url.split('#');
      title_url_array.forEach((title_url: string) => {
        const episode_title_url = title_url.split('$');
        if (
          episode_title_url.length === 2 &&
          isM3u8Link(episode_title_url[1])
        ) {
          matchTitles.push(episode_title_url[0]);
          matchEpisodes.push(episode_title_url[1]);
        }
      });
      if (matchEpisodes.length > episodes.length) {
        episodes = matchEpisodes;
        titles = matchTitles;
      }
    });
  }
  if (episodes.length === 0 && videoDetail.vod_content) {
    const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
    episodes = matches.map((link: string) => link.replace(/^\$/, ''));
  }
  return localizeSearchResult({
    id: id.toString(),
    title: videoDetail.vod_name,
    poster: videoDetail.vod_pic,
    episodes,
    episodes_titles: titles,
    source: apiSite.key,
    source_name: apiSite.name,
    class: videoDetail.vod_class,
    year: videoDetail.vod_year
      ? videoDetail.vod_year.match(/\d{4}/)?.[0] || ''
      : 'unknown',
    desc: cleanHtmlTags(videoDetail.vod_content),
    type_name: videoDetail.type_name,
    douban_id: videoDetail.vod_douban_id,
  });
}

async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  const response = await fetchSafeRemoteUrl(detailUrl, {
    headers: API_CONFIG.detail.headers,
    signal: controller.signal,
  });
  if (!response.ok) {
    clearTimeout(timeoutId);
    throw new Error(`詳情頁請求失敗: ${response.status}`);
  }
  const html = await response.text();
  clearTimeout(timeoutId);
  let matches: string[] = [];
  if (apiSite.key === 'ffzy') {
    const ffzyPattern =
      /\$(https?:\/\/[^"'\s]+?\/\d{8}\/\d+_[a-f0-9]+\/index\.m3u8)/g;
    matches = html.match(ffzyPattern) || [];
  }
  if (matches.length === 0) {
    const generalPattern = /\$(https?:\/\/[^"'\s]+?\.m3u8)/g;
    matches = html.match(generalPattern) || [];
  }
  matches = Array.from(new Set(matches)).map((link: string) => {
    link = link.substring(1);
    const parenIndex = link.indexOf('(');
    return parenIndex > 0 ? link.substring(0, parenIndex) : link;
  });
  const episodes_titles = Array.from({ length: matches.length }, (_, i) =>
    (i + 1).toString()
  );
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
  const titleText = titleMatch ? titleMatch[1].trim() : '';
  const descMatch = html.match(
    /<div[^>]*class=["']sketch["'][^>]*>([\s\S]*?)<\/div>/
  );
  const descText = descMatch ? cleanHtmlTags(descMatch[1]) : '';
  const coverMatch = html.match(/(https?:\/\/[^"'\s]+?\.jpg)/g);
  const coverUrl = coverMatch ? coverMatch[0].trim() : '';
  const yearMatch =
    html.match(/>(\d{4})<\//)?.[1] ??
    html.match(/>(\d{4})</g)?.[0]?.match(/\d{4}/)?.[0];
  const yearText = yearMatch || 'unknown';
  return localizeSearchResult({
    id,
    title: titleText,
    poster: coverUrl,
    episodes: matches,
    episodes_titles,
    source: apiSite.key,
    source_name: apiSite.name,
    class: '',
    year: yearText,
    desc: descText,
    type_name: '',
    douban_id: 0,
  });
}
