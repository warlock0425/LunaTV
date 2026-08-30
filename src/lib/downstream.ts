/* eslint-disable @typescript-eslint/no-explicit-any */
import { API_CONFIG, ApiSite } from '@/lib/config';
import { withOutboundSlot } from '@/lib/outbound-gate';
import { getCachedSearchPage, setCachedSearchPage } from '@/lib/search-cache';
import {
  getSearchHotPathMaxVariants,
  getSearchPageTimeoutMs,
} from '@/lib/search-runtime';
import { SearchResult } from '@/lib/types';
import {
  fetchSafeRemoteUrl,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/url-safety';
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

const MAX_VOD_API_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_DETAIL_HTML_BYTES = 5 * 1024 * 1024;
/** 長劇詳情 JSON 很大，10 秒容易超時只拿到探針。 */
const DETAIL_FETCH_TIMEOUT_MS = 25_000;

export class DownstreamNotFoundError extends Error {
  constructor(message = 'The requested media was not found upstream') {
    super(message);
    this.name = 'DownstreamNotFoundError';
  }
}

export class DownstreamTimeoutError extends Error {
  constructor(message = 'The upstream detail request timed out') {
    super(message);
    this.name = 'DownstreamTimeoutError';
  }
}

export class DownstreamUpstreamError extends Error {
  readonly status?: number;

  constructor(message = 'The upstream detail request failed', status?: number) {
    super(message);
    this.name = 'DownstreamUpstreamError';
    this.status = status;
  }
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      (error as Error & { code?: number }).code === 20)
  );
}

function cancelResponseBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

/**
 * 搜尋／詳情結果必須保留 CMS 原文（含簡體片名與簡介）。
 * 繁簡與台譯只負責「找得到」，不得改寫使用者看到的上游標題。
 * 呼叫點留在 isFuzzyMatch 之後，方便日後若要加非標題欄位處理時不碰比對順序。
 */
export function localizeSearchResult(result: SearchResult): SearchResult {
  return result;
}

/** 上游標題的空白正規化：去首尾、把連續空白塌縮為單一半形空格 */
function normalizeUpstreamTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

/** m3u8 連結判斷：容許帶查詢參數（如 xxx.m3u8?sign=...） */
function isM3u8Link(url: string): boolean {
  return /\.m3u8($|\?)/i.test(url);
}

/** CMS 搜尋列常沒有 vod_play_url，但 remarks 會寫「更新至24集」。 */
export function parseEpisodeCountFromRemarks(remarks: unknown): number {
  if (typeof remarks !== 'string') return 0;
  const text = remarks.trim();
  if (!text) return 0;
  const patterns = [
    /(?:更新至|更至|\u8fde\u8f7d\u81f3|連載至)\s*第?\s*(\d+)/i,
    /全\s*(\d+)\s*集/,
    /(\d+)\s*集(?:全|完)?/,
    /第\s*(\d+)\s*集/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = Number(match[1]);
    if (Number.isFinite(count) && count > 0 && count < 10000) return count;
  }
  return 0;
}

/**
 * 解析 vod_play_url（`播放組$$$播放組`，每組 `標題$網址#標題$網址`）。
 * 只在第一個 `$` 切開，後面整段當網址（簽名路徑裡也可能有 `$`）。
 * 沒有標題、只有 m3u8 的格式也收。
 */
export function parseVodPlayUrl(vodPlayUrl: unknown): {
  episodes: string[];
  titles: string[];
} {
  let episodes: string[] = [];
  let titles: string[] = [];
  if (typeof vodPlayUrl !== 'string' || !vodPlayUrl) {
    return { episodes, titles };
  }

  vodPlayUrl.split('$$$').forEach((group) => {
    const matchEpisodes: string[] = [];
    const matchTitles: string[] = [];
    group.split('#').forEach((titleUrl) => {
      const raw = titleUrl.trim();
      if (!raw) return;
      const dollar = raw.indexOf('$');
      const title = dollar >= 0 ? raw.slice(0, dollar).trim() : '';
      const url = dollar >= 0 ? raw.slice(dollar + 1).trim() : raw;
      if (!isM3u8Link(url)) return;
      matchTitles.push(title || `${matchEpisodes.length + 1}`);
      matchEpisodes.push(url);
    });
    if (matchEpisodes.length > episodes.length) {
      episodes = matchEpisodes;
      titles = matchTitles;
    }
  });

  return { episodes, titles };
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
  timeoutMs = getSearchPageTimeoutMs(),
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

  // 呼叫端已經取消就別發請求。但一旦進到 deduplicateRequest，這個 fetch 就是
  // 多個併發呼叫端共用的，絕不能再綁任何「單一呼叫端」的 signal——否則其中一位
  // 使用者離開頁面時會連帶中止共用請求，其他人也一起拿到空結果。
  // 逾時由下方自己的 controller 負責，最多多跑 timeoutMs，結果還能進快取。
  if (parentSignal?.aborted) {
    return { results: [] };
  }

  const cacheKey = `${apiSite.key}::${query}::${page}`;
  return deduplicateRequest(cacheKey, async () => {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await withOutboundSlot(
        () =>
          fetchSafeRemoteUrl(url, {
            headers: API_CONFIG.search.headers,
            signal: controller.signal,
          }),
        controller.signal
      );
      // 有收到 HTTP 回應即代表來源存活，重置熔斷計數
      if (!response.ok) {
        if (response.status === 403)
          setCachedSearchPage(apiSite.key, query, page, 'forbidden', []);
        return { results: [] };
      }
      const data = await readResponseJsonWithLimit<any>(
        response,
        MAX_VOD_API_RESPONSE_BYTES
      );
      recordSourceSuccess(apiSite.key);
      if (
        !data ||
        !data.list ||
        !Array.isArray(data.list) ||
        data.list.length === 0
      ) {
        return { results: [] };
      }
      // 逐筆解析：採集站資料品質參差，單筆缺 vod_id / vod_name 不該讓整個
      // 片源的結果被外層 catch 吃掉變成空陣列（那會讓該源整站搜不到東西）。
      const results = data.list.flatMap((item: ApiSearchItem) => {
        if (item?.vod_id === undefined || item?.vod_id === null) return [];
        if (typeof item.vod_name !== 'string' || !item.vod_name.trim())
          return [];

        const { episodes, titles } = parseVodPlayUrl(item.vod_play_url);
        const episodeCount = Math.max(
          episodes.length,
          parseEpisodeCountFromRemarks(item.vod_remarks)
        );

        return [
          {
            id: String(item.vod_id),
            title: normalizeUpstreamTitle(item.vod_name),
            poster: item.vod_pic,
            episodes,
            episodes_titles: titles,
            episode_count: episodeCount,
            source: apiSite.key,
            source_name: apiSite.name,
            class: item.vod_class,
            // 保持原語意：vod_year 為空／缺漏時填入哨兵值 'unknown'。
            // String() 只是讓數字型 vod_year 不再拋錯（原本會整批失敗）。
            year: item.vod_year
              ? String(item.vod_year).match(/\d{4}/)?.[0] || ''
              : 'unknown',
            desc: cleanHtmlTags(item.vod_content || ''),
            type_name: item.type_name,
            douban_id: item.vod_douban_id,
          } as SearchResult,
        ];
      });
      const pageCount = page === 1 ? data.pagecount || 1 : undefined;
      setCachedSearchPage(apiSite.key, query, page, 'ok', results, pageCount);
      return { results, pageCount };
    } catch (error: any) {
      if (timedOut && (error?.name === 'AbortError' || error?.code === 20)) {
        setCachedSearchPage(apiSite.key, query, page, 'timeout', []);
        recordSourceFailure(apiSite.key);
      } else if (error?.name !== 'AbortError') {
        // 連線失敗（DNS 解析失敗、拒絕連線等）也計入熔斷
        recordSourceFailure(apiSite.key);
      }
      return { results: [] };
    } finally {
      clearTimeout(timeoutId);
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
    ).slice(0, getSearchHotPathMaxVariants());
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
        getSearchPageTimeoutMs(),
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
    for (const { results: variantData } of variantResults) {
      variantData.forEach((result) => {
        const uniqueKey = `${result.source}_${result.id}`;
        if (!seenIds.has(uniqueKey)) {
          seenIds.add(uniqueKey);
          results.push(localizeSearchResult(result));
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
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DETAIL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchSafeRemoteUrl(detailUrl, {
      headers: API_CONFIG.detail.headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      cancelResponseBody(response);
      if (response.status === 404 || response.status === 410) {
        throw new DownstreamNotFoundError();
      }
      throw new DownstreamUpstreamError(
        `The upstream detail request returned HTTP ${response.status}`,
        response.status
      );
    }
    const data = await readResponseJsonWithLimit<any>(
      response,
      MAX_VOD_API_RESPONSE_BYTES
    );
    if (!data || !Array.isArray(data.list) || data.list.length === 0) {
      throw new DownstreamNotFoundError();
    }
    const videoDetail = data.list[0];
    // list[0] 為 null 時視同查無資料。若放行，端點會回 200 + 零集數，
    // 播放頁只會顯示空播放器而不是「未找到匹配結果」。
    if (!videoDetail || typeof videoDetail !== 'object') {
      throw new DownstreamNotFoundError();
    }
    const parsed = parseVodPlayUrl(videoDetail.vod_play_url);
    let episodes = parsed.episodes;
    const titles = parsed.titles;
    if (episodes.length === 0 && typeof videoDetail.vod_content === 'string') {
      const matches = videoDetail.vod_content.match(M3U8_PATTERN) || [];
      episodes = matches.map((link: string) => link.replace(/^\$/, ''));
    }
    return localizeSearchResult({
      id: id.toString(),
      // 與搜尋路徑一致地正規化空白。兩條路徑對同一部片回傳不同空白的標題，
      // 會讓顯示、播放紀錄裡存的標題、以及依「標題完全相等」比對的客戶端
      // （例如 OrionTV）出現對不上的情況。
      title: normalizeUpstreamTitle(videoDetail.vod_name),
      poster: videoDetail.vod_pic,
      episodes,
      episodes_titles: titles,
      episode_count: episodes.length,
      source: apiSite.key,
      source_name: apiSite.name,
      class: videoDetail.vod_class,
      year: videoDetail.vod_year
        ? String(videoDetail.vod_year).match(/\d{4}/)?.[0] || ''
        : 'unknown',
      desc: cleanHtmlTags(videoDetail.vod_content || ''),
      type_name: videoDetail.type_name,
      douban_id: videoDetail.vod_douban_id,
    });
  } catch (error) {
    if (
      error instanceof DownstreamNotFoundError ||
      error instanceof DownstreamUpstreamError
    ) {
      throw error;
    }
    if (timedOut && isAbortError(error)) {
      throw new DownstreamTimeoutError();
    }
    throw new DownstreamUpstreamError();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleSpecialSourceDetail(
  id: string,
  apiSite: ApiSite
): Promise<SearchResult> {
  const detailUrl = `${apiSite.detail}/index.php/vod/detail/id/${id}.html`;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DETAIL_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchSafeRemoteUrl(detailUrl, {
      headers: API_CONFIG.detail.headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      cancelResponseBody(response);
      if (response.status === 404 || response.status === 410) {
        throw new DownstreamNotFoundError();
      }
      throw new DownstreamUpstreamError(
        `The upstream detail page returned HTTP ${response.status}`,
        response.status
      );
    }
    const html = await readResponseTextWithLimit(
      response,
      MAX_DETAIL_HTML_BYTES
    );
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
    if (!titleText && matches.length === 0) {
      throw new DownstreamNotFoundError();
    }
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
      episode_count: matches.length,
      source: apiSite.key,
      source_name: apiSite.name,
      class: '',
      year: yearText,
      desc: descText,
      type_name: '',
      douban_id: 0,
    });
  } catch (error) {
    if (
      error instanceof DownstreamNotFoundError ||
      error instanceof DownstreamUpstreamError
    ) {
      throw error;
    }
    if (timedOut && isAbortError(error)) {
      throw new DownstreamTimeoutError();
    }
    throw new DownstreamUpstreamError();
  } finally {
    clearTimeout(timeoutId);
  }
}
