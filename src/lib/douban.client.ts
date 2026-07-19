/* eslint-disable @typescript-eslint/no-explicit-any,no-case-declarations */
import { toSimplified } from './douban';
import { DoubanItem, DoubanResult } from './types';
interface DoubanCategoriesParams {
  kind: 'tv' | 'movie';
  category: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

interface DoubanListApiResponse {
  total: number;
  subjects: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    cover: string;
    rate: string;
  }>;
}

interface DoubanRecommendApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    year: string;
    type: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

/**
 * 带超時的 fetch 請求
 */
async function fetchWithTimeout(
  url: string,
  proxyUrl: string
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超時

  // 檢查是否使用代理
  const finalUrl =
    proxyUrl === 'https://cors-anywhere.com/'
      ? `${proxyUrl}${url}`
      : proxyUrl
        ? `${proxyUrl}${encodeURIComponent(url)}`
        : url;

  const fetchOptions: RequestInit = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
    },
  };

  try {
    return await fetch(finalUrl, fetchOptions);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// 豆瓣直連回應的瀏覽器端快取。
// 豆瓣/CDN 回應帶有 `expires: 2006` 且無 Cache-Control，瀏覽器完全不會快取，
// 導致每次進首頁、切分類、返回導航都整批重新下載。此處以 sessionStorage
// 做短 TTL 快取（分頁關閉即清空），讓返回導航即時顯示並減少 CDN 請求。
// 走伺服器的 /api/douban/* 路徑已有 HTTP Cache-Control，不經過這層。
// ---------------------------------------------------------------------------
const DOUBAN_CACHE_PREFIX = 'douban-cache:';
const DOUBAN_CACHE_TTL_MS = 30 * 60 * 1000; // 30 分鐘

function readDoubanCache<T>(url: string): T | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DOUBAN_CACHE_PREFIX + url);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { t: number; d: T };
    if (Date.now() - entry.t > DOUBAN_CACHE_TTL_MS) {
      sessionStorage.removeItem(DOUBAN_CACHE_PREFIX + url);
      return null;
    }
    return entry.d;
  } catch {
    return null;
  }
}

function writeDoubanCache(url: string, data: unknown): void {
  if (typeof sessionStorage === 'undefined') return;
  const entry = JSON.stringify({ t: Date.now(), d: data });
  try {
    sessionStorage.setItem(DOUBAN_CACHE_PREFIX + url, entry);
  } catch {
    // 容量不足：清掉本站的豆瓣快取後重試一次，仍失敗則放棄快取
    try {
      const staleKeys: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(DOUBAN_CACHE_PREFIX)) staleKeys.push(key);
      }
      staleKeys.forEach((key) => sessionStorage.removeItem(key));
      sessionStorage.setItem(DOUBAN_CACHE_PREFIX + url, entry);
    } catch {
      // ignore
    }
  }
}

/** 帶快取的豆瓣 JSON 請求（快取鍵為目標網址，與代理方式無關） */
async function fetchDoubanJson<T>(url: string, proxyUrl: string): Promise<T> {
  const cached = readDoubanCache<T>(url);
  if (cached !== null) return cached;

  const response = await fetchWithTimeout(url, proxyUrl);
  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }
  const data = (await response.json()) as T;
  writeDoubanCache(url, data);
  return data;
}

type DoubanProxyType =
  | 'cmliussss-cdn-tencent'
  | 'cmliussss-cdn-ali'
  | 'custom'
  | 'direct'
  | 'cors-proxy-zwei'
  | 'cors-anywhere';

function isValidProxyType(val: unknown): val is DoubanProxyType {
  return (
    typeof val === 'string' &&
    [
      'cmliussss-cdn-tencent',
      'cmliussss-cdn-ali',
      'custom',
      'direct',
      'cors-proxy-zwei',
      'cors-anywhere',
    ].includes(val)
  );
}

export function getDoubanProxyConfig(): {
  proxyType: DoubanProxyType;
  proxyUrl: string;
} {
  let doubanProxyType: DoubanProxyType = 'cmliussss-cdn-tencent';

  if (typeof window !== 'undefined') {
    const rawType =
      localStorage.getItem('doubanDataSource') ||
      window.RUNTIME_CONFIG?.DOUBAN_PROXY_TYPE;
    if (isValidProxyType(rawType)) {
      doubanProxyType = rawType;
    }
  }

  const doubanProxy =
    typeof window !== 'undefined'
      ? localStorage.getItem('doubanProxyUrl') ||
        window.RUNTIME_CONFIG?.DOUBAN_PROXY ||
        ''
      : '';

  return {
    proxyType: doubanProxyType,
    proxyUrl: doubanProxy,
  };
}

/**
 * 瀏覽器端豆瓣分類數據取得函數
 */
export async function fetchDoubanCategories(
  params: DoubanCategoriesParams,
  proxyUrl: string,
  useTencentCDN = false,
  useAliCDN = false
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;

  // 驗證參數
  if (!['tv', 'movie'].includes(kind)) {
    throw new Error('kind 參數必须是 tv 或 movie');
  }

  if (!category || !type) {
    throw new Error('category 和 type 參數不能为空');
  }

  if (pageLimit < 1 || pageLimit > 100) {
    throw new Error('pageLimit 必须在 1-100 之間');
  }

  if (pageStart < 0) {
    throw new Error('pageStart 不能小於 0');
  }
  const simCategory = toSimplified(category);
  const simType = toSimplified(type);

  const target = useTencentCDN
    ? `https://m.douban.cmliussss.net/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${encodeURIComponent(
        simCategory
      )}&type=${encodeURIComponent(simType)}`
    : useAliCDN
      ? `https://m.douban.cmliussss.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${encodeURIComponent(
          simCategory
        )}&type=${encodeURIComponent(simType)}`
      : `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${encodeURIComponent(
          simCategory
        )}&type=${encodeURIComponent(simType)}`;

  try {
    const doubanData = await fetchDoubanJson<DoubanCategoryApiResponse>(
      target,
      useTencentCDN || useAliCDN ? '' : proxyUrl
    );

    // 轉換數據格式
    const list: DoubanItem[] = doubanData.items.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    return {
      code: 200,
      message: '取得成功',
      list: list,
    };
  } catch (error) {
    // 触發全局錯誤提示
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('globalError', {
          detail: { message: '取得豆瓣分類數據失敗' },
        })
      );
    }
    throw new Error(`取得豆瓣分類數據失敗: ${(error as Error).message}`);
  }
}

/**
 * 統一的豆瓣分類數據取得函數，根據代理設置選擇使用服務端 API 或客戶端代理取得
 */
export async function getDoubanCategories(
  params: DoubanCategoriesParams
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;
  const { proxyType, proxyUrl } = getDoubanProxyConfig();
  switch (proxyType) {
    case 'cors-proxy-zwei':
      return fetchDoubanCategories(params, 'https://ciao-cors.is-an.org/');
    case 'cmliussss-cdn-tencent':
      return fetchDoubanCategories(params, '', true, false);
    case 'cmliussss-cdn-ali':
      return fetchDoubanCategories(params, '', false, true);
    case 'cors-anywhere':
      return fetchDoubanCategories(params, 'https://cors-anywhere.com/');
    case 'custom':
      return fetchDoubanCategories(params, proxyUrl);
    case 'direct':
    default:
      const response = await fetch(
        `/api/douban/categories?kind=${kind}&category=${category}&type=${type}&limit=${pageLimit}&start=${pageStart}`
      );

      return response.json();
  }
}

export async function getDoubanCategoriesFromServer(
  params: DoubanCategoriesParams
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;
  const searchParams = new URLSearchParams({
    kind,
    category,
    type,
    limit: String(pageLimit),
    start: String(pageStart),
  });
  const response = await fetch(`/api/douban/categories?${searchParams}`);
  return response.json();
}

interface DoubanListParams {
  tag: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

export async function getDoubanList(
  params: DoubanListParams
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;
  const { proxyType, proxyUrl } = getDoubanProxyConfig();
  switch (proxyType) {
    case 'cors-proxy-zwei':
      return fetchDoubanList(params, 'https://ciao-cors.is-an.org/');
    case 'cmliussss-cdn-tencent':
      return fetchDoubanList(params, '', true, false);
    case 'cmliussss-cdn-ali':
      return fetchDoubanList(params, '', false, true);
    case 'cors-anywhere':
      return fetchDoubanList(params, 'https://cors-anywhere.com/');
    case 'custom':
      return fetchDoubanList(params, proxyUrl);
    case 'direct':
    default:
      const response = await fetch(
        `/api/douban?tag=${tag}&type=${type}&pageSize=${pageLimit}&pageStart=${pageStart}`
      );

      return response.json();
  }
}

export async function getDoubanListFromServer(
  params: DoubanListParams
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;
  const searchParams = new URLSearchParams({
    tag,
    type,
    pageSize: String(pageLimit),
    pageStart: String(pageStart),
  });
  const response = await fetch(`/api/douban?${searchParams}`);
  return response.json();
}

export async function fetchDoubanList(
  params: DoubanListParams,
  proxyUrl: string,
  useTencentCDN = false,
  useAliCDN = false
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;

  // 驗證參數
  if (!tag || !type) {
    throw new Error('tag 和 type 參數不能为空');
  }

  if (!['tv', 'movie'].includes(type)) {
    throw new Error('type 參數必须是 tv 或 movie');
  }

  if (pageLimit < 1 || pageLimit > 100) {
    throw new Error('pageLimit 必须在 1-100 之間');
  }

  if (pageStart < 0) {
    throw new Error('pageStart 不能小於 0');
  }

  const simTag = toSimplified(tag);

  const target = useTencentCDN
    ? `https://movie.douban.cmliussss.net/j/search_subjects?type=${type}&tag=${encodeURIComponent(
        simTag
      )}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`
    : useAliCDN
      ? `https://movie.douban.cmliussss.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(
          simTag
        )}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`
      : `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(
          simTag
        )}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;

  try {
    const doubanData = await fetchDoubanJson<DoubanListApiResponse>(
      target,
      useTencentCDN || useAliCDN ? '' : proxyUrl
    );

    // 轉換數據格式
    const list: DoubanItem[] = doubanData.subjects.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.cover,
      rate: item.rate,
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    return {
      code: 200,
      message: '取得成功',
      list: list,
    };
  } catch (error) {
    // 触發全局錯誤提示
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('globalError', {
          detail: { message: '取得豆瓣列表數據失敗' },
        })
      );
    }
    throw new Error(`取得豆瓣分類數據失敗: ${(error as Error).message}`);
  }
}

interface DoubanRecommendsParams {
  kind: 'tv' | 'movie';
  pageLimit?: number;
  pageStart?: number;
  category?: string;
  format?: string;
  label?: string;
  region?: string;
  year?: string;
  platform?: string;
  sort?: string;
}

export async function getDoubanRecommends(
  params: DoubanRecommendsParams
): Promise<DoubanResult> {
  const { proxyType, proxyUrl } = getDoubanProxyConfig();
  switch (proxyType) {
    case 'cors-proxy-zwei':
      return fetchDoubanRecommends(params, 'https://ciao-cors.is-an.org/');
    case 'cmliussss-cdn-tencent':
      return fetchDoubanRecommends(params, '', true, false);
    case 'cmliussss-cdn-ali':
      return fetchDoubanRecommends(params, '', false, true);
    case 'cors-anywhere':
      return fetchDoubanRecommends(params, 'https://cors-anywhere.com/');
    case 'custom':
      return fetchDoubanRecommends(params, proxyUrl);
    case 'direct':
    default:
      return getDoubanRecommendsFromServer(params);
  }
}

export async function getDoubanRecommendsFromServer(
  params: DoubanRecommendsParams
): Promise<DoubanResult> {
  const {
    kind,
    pageLimit = 20,
    pageStart = 0,
    category,
    format,
    label,
    region,
    year,
    platform,
    sort,
  } = params;
  const searchParams = new URLSearchParams({
    kind,
    limit: String(pageLimit),
    start: String(pageStart),
  });

  appendOptionalParam(searchParams, 'category', category);
  appendOptionalParam(searchParams, 'format', format);
  appendOptionalParam(searchParams, 'region', region);
  appendOptionalParam(searchParams, 'year', year);
  appendOptionalParam(searchParams, 'platform', platform);
  appendOptionalParam(searchParams, 'sort', sort);
  appendOptionalParam(searchParams, 'label', label);

  const response = await fetch(`/api/douban/recommends?${searchParams}`);
  return response.json();
}

function appendOptionalParam(
  searchParams: URLSearchParams,
  key: string,
  value?: string
) {
  if (value !== undefined && value !== null) {
    searchParams.set(key, value);
  }
}

async function fetchDoubanRecommends(
  params: DoubanRecommendsParams,
  proxyUrl: string,
  useTencentCDN = false,
  useAliCDN = false
): Promise<DoubanResult> {
  const { kind, pageLimit = 20, pageStart = 0 } = params;
  let { category, format, region, year, platform, sort, label } = params;
  if (category === 'all') {
    category = '';
  } else {
    category = toSimplified(category || '');
  }
  if (format === 'all') {
    format = '';
  } else {
    format = toSimplified(format || '');
  }
  if (label === 'all') {
    // 保留 'all' 值，不轉換为空字符串，让 API 使用預設行为
    label = '';
  } else {
    label = toSimplified(label || '');
  }
  if (region === 'all') {
    region = '';
  } else {
    region = toSimplified(region || '');
  }
  if (year === 'all') {
    year = '';
  } else {
    year = toSimplified(year || '');
  }
  if (platform === 'all') {
    platform = '';
  } else {
    platform = toSimplified(platform || '');
  }
  if (sort === 'T') {
    sort = '';
  }

  const selectedCategories = { 類型: category } as any;
  if (format) {
    selectedCategories['形式'] = format;
  }
  if (region) {
    selectedCategories['地区'] = region;
  }

  const tags = [] as Array<string>;
  if (category) {
    tags.push(category);
  }
  if (!category && format) {
    tags.push(format);
  }
  if (label) {
    tags.push(label);
  }
  if (region) {
    tags.push(region);
  }
  if (year) {
    tags.push(year);
  }
  if (platform) {
    tags.push(platform);
  }

  const baseUrl = useTencentCDN
    ? `https://m.douban.cmliussss.net/rexxar/api/v2/${kind}/recommend`
    : useAliCDN
      ? `https://m.douban.cmliussss.com/rexxar/api/v2/${kind}/recommend`
      : `https://m.douban.com/rexxar/api/v2/${kind}/recommend`;
  const reqParams = new URLSearchParams();
  reqParams.append('refresh', '0');
  reqParams.append('start', pageStart.toString());
  reqParams.append('count', pageLimit.toString());
  reqParams.append('selected_categories', JSON.stringify(selectedCategories));
  reqParams.append('uncollect', 'false');
  reqParams.append('score_range', '0,10');
  reqParams.append('tags', tags.join(','));
  if (sort) {
    reqParams.append('sort', sort);
  }
  const target = `${baseUrl}?${reqParams.toString()}`;
  try {
    const doubanData = await fetchDoubanJson<DoubanRecommendApiResponse>(
      target,
      useTencentCDN || useAliCDN ? '' : proxyUrl
    );
    const list: DoubanItem[] = doubanData.items
      .filter((item) => {
        // 兼容不同類型的type值：movie, tv, 可能是其他如 anime
        // 只要不是明確未知類型就保留
        const validTypes = ['movie', 'tv'];
        const itemType = item.type?.toString().toLowerCase();
        return validTypes.includes(itemType) || !itemType;
      })
      .map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.pic?.normal || item.pic?.large || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.year,
      }));

    return {
      code: 200,
      message: '取得成功',
      list: list,
    };
  } catch (error) {
    throw new Error(`取得豆瓣推薦數據失敗: ${(error as Error).message}`);
  }
}
