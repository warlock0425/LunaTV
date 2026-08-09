import { API_CONFIG, type ApiSite } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';
import {
  fetchSafeRemoteUrl,
  isSafeRemoteUrl,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/url-safety';

import { setBoundedMapValue } from './bounded-map';
import {
  describeSourceValidation,
  type SourceDisableSuggestion,
} from './source-validation-status';

/** 搜尋可達 / 詳情可解集數 / 抽樣 m3u8 可播 */
export type SourceCheckLevel = 'search' | 'detail' | 'playable';

export type SourceCheckState = 'pass' | 'fail' | 'skip';

/**
 * overall 相容舊 UI：
 * - valid: 至少完成 search，且 detail+playable 都過（可播）
 * - partial: search 過，但 detail 或 playable 未全過
 * - no_results: API 通但關鍵詞無命中
 * - invalid: 連線/解析失敗
 */
export type SourceValidationOverall =
  'valid' | 'partial' | 'no_results' | 'invalid';

export interface SourceValidationResult {
  source: string;
  status: SourceValidationOverall;
  levels: Record<SourceCheckLevel, SourceCheckState>;
  message: string;
  resultCount: number;
  episodeCount: number;
  latencyMs: number;
  checkedAt: number;
}

export interface ValidateSourceOptions {
  keyword: string;
  signal?: AbortSignal;
  /** 預設 true；單元測試可關 playable 探測 */
  probePlayback?: boolean;
  searchTimeoutMs?: number;
  playableTimeoutMs?: number;
}

const MAX_VALIDATION_CACHE = 500;
const MAX_SEARCH_JSON_BYTES = 2 * 1024 * 1024;
const MAX_M3U8_PROBE_BYTES = 8 * 1024;
const DEFAULT_PLAYABLE_TIMEOUT_MS = 6_000;

const lastValidationBySource = new Map<string, SourceValidationResult>();

export function getLastValidationResults(): SourceValidationResult[] {
  return Array.from(lastValidationBySource.values()).sort(
    (a, b) => b.checkedAt - a.checkedAt
  );
}

export function getLastValidation(
  sourceKey: string
): SourceValidationResult | null {
  return lastValidationBySource.get(sourceKey) || null;
}

export function rememberValidationResult(result: SourceValidationResult): void {
  setBoundedMapValue(
    lastValidationBySource,
    result.source,
    result,
    MAX_VALIDATION_CACHE
  );
}

export function clearValidationResult(sourceKey?: string): void {
  if (!sourceKey) {
    lastValidationBySource.clear();
    return;
  }
  lastValidationBySource.delete(sourceKey);
}

export function isM3u8Link(url: string): boolean {
  return /\.m3u8($|\?)/i.test(url);
}

/** 從 CMS vod_play_url 抽出 m3u8 集數（與 downstream 規則對齊） */
export function parseEpisodesFromVodPlayUrl(vodPlayUrl?: string): string[] {
  if (!vodPlayUrl || typeof vodPlayUrl !== 'string') return [];

  let best: string[] = [];
  for (const group of vodPlayUrl.split('$$$')) {
    const episodes: string[] = [];
    for (const part of group.split('#')) {
      const titleUrl = part.split('$');
      if (titleUrl.length >= 2 && isM3u8Link(titleUrl[titleUrl.length - 1])) {
        episodes.push(titleUrl[titleUrl.length - 1]);
      } else if (titleUrl.length === 1 && isM3u8Link(titleUrl[0])) {
        episodes.push(titleUrl[0]);
      }
    }
    if (episodes.length > best.length) best = episodes;
  }
  return best;
}

function emptyLevels(
  fill: SourceCheckState = 'skip'
): Record<SourceCheckLevel, SourceCheckState> {
  return { search: fill, detail: fill, playable: fill };
}

function buildResult(
  partial: Omit<SourceValidationResult, 'checkedAt'> & { checkedAt?: number }
): SourceValidationResult {
  const result: SourceValidationResult = {
    ...partial,
    checkedAt: partial.checkedAt ?? Date.now(),
  };
  rememberValidationResult(result);
  return result;
}

export async function probeM3u8Playable(
  url: string,
  signal?: AbortSignal,
  timeoutMs = DEFAULT_PLAYABLE_TIMEOUT_MS
): Promise<boolean> {
  if (!url || !isSafeRemoteUrl(url)) return false;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal?.aborted) return false;
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchSafeRemoteUrl(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: '*/*',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      response.body?.cancel();
      return false;
    }
    const text = await readResponseTextWithLimit(
      response,
      MAX_M3U8_PROBE_BYTES
    );
    return text.trimStart().startsWith('#EXTM3U');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * 對單一源做三級檢測。失敗只回報，不自動禁用源。
 */
export async function validateSourceSite(
  site: ApiSite,
  options: ValidateSourceOptions
): Promise<SourceValidationResult> {
  const startedAt = Date.now();
  const keyword = (options.keyword || '').trim();
  const probePlayback = options.probePlayback !== false;
  const levels = emptyLevels('skip');

  if (!keyword) {
    return buildResult({
      source: site.key,
      status: 'invalid',
      levels: emptyLevels('fail'),
      message: '缺少搜尋關鍵詞',
      resultCount: 0,
      episodeCount: 0,
      latencyMs: 0,
    });
  }

  let list: Array<Record<string, unknown>> = [];
  try {
    const searchUrl = `${site.api}${API_CONFIG.search.path}${encodeURIComponent(keyword)}`;
    const response = await fetchSafeRemoteUrl(searchUrl, {
      headers: API_CONFIG.search.headers,
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await readResponseJsonWithLimit(
      response,
      MAX_SEARCH_JSON_BYTES
    )) as { list?: unknown };
    list = Array.isArray(data?.list)
      ? (data.list as Array<Record<string, unknown>>)
      : [];
    levels.search = 'pass';
  } catch {
    levels.search = 'fail';
    return buildResult({
      source: site.key,
      status: 'invalid',
      levels,
      message: '搜尋連線失敗',
      resultCount: 0,
      episodeCount: 0,
      latencyMs: Date.now() - startedAt,
    });
  }

  if (list.length === 0) {
    return buildResult({
      source: site.key,
      status: 'no_results',
      levels: { ...levels, detail: 'skip', playable: 'skip' },
      message: 'API 可達，但無搜尋結果',
      resultCount: 0,
      episodeCount: 0,
      latencyMs: Date.now() - startedAt,
    });
  }

  const normalizedKeyword = keyword.toLowerCase();
  const matched =
    list.find((item) =>
      String(item?.vod_name || '')
        .toLowerCase()
        .includes(normalizedKeyword)
    ) || null;

  if (!matched) {
    return buildResult({
      source: site.key,
      status: 'no_results',
      levels: { ...levels, detail: 'skip', playable: 'skip' },
      message: '有結果，但未命中關鍵詞',
      resultCount: list.length,
      episodeCount: 0,
      latencyMs: Date.now() - startedAt,
    });
  }

  // L2：先吃搜尋結果內嵌 play url，不足再打 detail API
  let episodes = parseEpisodesFromVodPlayUrl(
    typeof matched.vod_play_url === 'string' ? matched.vod_play_url : undefined
  );

  if (episodes.length === 0) {
    const vodId = matched.vod_id != null ? String(matched.vod_id) : '';
    if (vodId) {
      try {
        const detail = await getDetailFromApi(site, vodId);
        episodes = Array.isArray(detail.episodes) ? detail.episodes : [];
      } catch {
        episodes = [];
      }
    }
  }

  if (episodes.length > 0) {
    levels.detail = 'pass';
  } else {
    levels.detail = 'fail';
    return buildResult({
      source: site.key,
      status: 'partial',
      levels: { ...levels, playable: 'skip' },
      message: '可搜尋，但無法解析集數',
      resultCount: list.length,
      episodeCount: 0,
      latencyMs: Date.now() - startedAt,
    });
  }

  // L3：只抽樣第一集 m3u8 檔頭，不下整部
  if (!probePlayback) {
    levels.playable = 'skip';
    return buildResult({
      source: site.key,
      status: 'partial',
      levels,
      message: `可解析 ${episodes.length} 集（未探測播放）`,
      resultCount: list.length,
      episodeCount: episodes.length,
      latencyMs: Date.now() - startedAt,
    });
  }

  const playable = await probeM3u8Playable(
    episodes[0],
    options.signal,
    options.playableTimeoutMs
  );
  levels.playable = playable ? 'pass' : 'fail';

  if (playable) {
    return buildResult({
      source: site.key,
      status: 'valid',
      levels,
      message: `可搜、可解、可播（${episodes.length} 集）`,
      resultCount: list.length,
      episodeCount: episodes.length,
      latencyMs: Date.now() - startedAt,
    });
  }

  return buildResult({
    source: site.key,
    status: 'partial',
    levels,
    message: `可搜可解 ${episodes.length} 集，但 m3u8 抽樣失敗`,
    resultCount: list.length,
    episodeCount: episodes.length,
    latencyMs: Date.now() - startedAt,
  });
}

/** 數值越小越優先；未知來源排中間，不直接沉底以免誤殺未檢測源 */
export function getSourceValidationRank(sourceKey: string): number {
  const result = getLastValidation(sourceKey);
  if (!result) return 30;
  switch (result.status) {
    case 'valid':
      return 0;
    case 'partial':
      return 15;
    case 'no_results':
      return 40;
    case 'invalid':
      return 80;
    default:
      return 30;
  }
}

/**
 * 依最近三級檢測結果排序（穩定排序）。
 * 僅改變順序，不移除、不禁用任何來源。
 */
export function orderSourcesByValidation<T extends { key: string }>(
  sites: T[]
): T[] {
  return sites
    .map((site, index) => ({
      site,
      index,
      rank: getSourceValidationRank(site.key),
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.site);
}

/**
 * 給後台展示：是否建議人工檢查／停用（不自動執行）。
 *
 * 判讀規則放在 source-validation-status，管理端 client component 直接用
 * describeSourceValidation 讀 SSE 拿到的結果，兩邊同一份規則。
 */
export function getSourceDisableSuggestion(
  sourceKey: string
): SourceDisableSuggestion | null {
  return describeSourceValidation(getLastValidation(sourceKey));
}
