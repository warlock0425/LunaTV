import { cleanQueryForApi, toSearchSimplified } from './chinese';
import { convertTaiwanToMainland } from './opencc-mainland';
import { isFuzzyMatch } from './searchEngine';

/**
 * 以豆瓣作為「台灣片名 → 大陸片名」的通用別名來源。
 *
 * 手寫別名表（regional-title-aliases）永遠追不上院線與串流的新片，
 * 而豆瓣的條目本身就同時收錄兩岸譯名（搜尋會比對「又名」欄位）。
 * 因此當本地字元轉換與別名表都找不到片源時，改用豆瓣反查大陸片名。
 *
 * 此模組僅負責「組請求」與「解析回應」兩件純邏輯，方便單元測試；
 * 實際發送與快取由 API 路由處理。
 */

const DOUBAN_SEARCH_HOSTS: Record<string, string> = {
  'cmliussss-cdn-tencent': 'https://m.douban.cmliussss.net',
  'cmliussss-cdn-ali': 'https://m.douban.cmliussss.com',
  direct: 'https://m.douban.com',
};

const CJK_PATTERN = /[㐀-鿿]/;

/** 豆瓣搜尋回應中我們需要的最小結構 */
interface DoubanSearchItem {
  target?: { title?: string; year?: string };
  title?: string;
  target_type?: string;
  type_name?: string;
}

export interface DoubanSearchResponse {
  subjects?: { items?: DoubanSearchItem[] };
  items?: DoubanSearchItem[];
}

const DEFAULT_DOUBAN_SEARCH_PROXY = 'cmliussss-cdn-tencent';

export function buildDoubanSearchUrl(
  query: string,
  proxyType = DEFAULT_DOUBAN_SEARCH_PROXY
): string {
  // 用 hasOwnProperty 而非直接索引：proxyType 來自查詢參數，值為 'constructor'
  // 或 'toString' 時會取到原型鏈上的函式。那是個 truthy 值，會讓 || 的預設值
  // 失效，宣告回傳 string 的表其實給出函式，最後拼成
  // 「function Object() { [native code] }/rexxar/...」這種必然解析失敗的 URL。
  // 與 douban.ts 的 toSimplified 是同一類問題（1ec87a9 已修那一處）。
  const host = Object.prototype.hasOwnProperty.call(
    DOUBAN_SEARCH_HOSTS,
    proxyType
  )
    ? DOUBAN_SEARCH_HOSTS[proxyType]
    : DOUBAN_SEARCH_HOSTS[DEFAULT_DOUBAN_SEARCH_PROXY];
  const params = new URLSearchParams({ q: query, count: '5' });
  return `${host}/rexxar/api/v2/search/subjects?${params.toString()}`;
}

function collectTitles(payload: DoubanSearchResponse): string[] {
  const items = payload.subjects?.items || payload.items || [];
  return items
    .map((item) => item.target?.title || item.title || '')
    .map((title) => title.trim())
    .filter(Boolean);
}

/**
 * 從豆瓣搜尋結果挑出可用的大陸片名。
 *
 * 只保留「與原查詢確實不同」且含中日韓字的標題——若標題與原查詢
 * 字元轉換後相同，代表本來就搜得到，不需要別名。
 */
export function extractMainlandAliases(
  payload: DoubanSearchResponse,
  originalQuery: string,
  limit = 3
): string[] {
  const baseline = toSearchSimplified(
    convertTaiwanToMainland(cleanQueryForApi(originalQuery))
  ).trim();
  const seen = new Set<string>();
  const aliases: string[] = [];

  for (const title of collectTitles(payload)) {
    if (!CJK_PATTERN.test(title)) continue;
    const normalized = toSearchSimplified(title).trim();
    if (!normalized || normalized === baseline) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    aliases.push(normalized);
    if (aliases.length >= limit) break;
  }

  return aliases;
}

/** 集數／季別／副標題等後綴，去掉後才是可用於片源站搜尋的系列主名 */
const TRAILING_NOISE_PATTERN =
  /(\s*第[一二三四五六七八九十\d]+[季部篇章]\s*$)|(\s*[:：].*$)|(\s*\d+\s*$)/;

/**
 * 從候選別名中挑一個最適合拿去片源站搜尋的。
 *
 * 豆瓣搜尋依相關度排序，第一筆即為最佳對應；但它常帶有集數或副標題
 * （「指环王1：护戒使者」「心灵猎人 第一季」），對片源站而言過度specific，
 * 因此去掉尾綴還原系列主名。
 *
 * 注意：早期版本改用「跨結果最長共同前綴」，但豆瓣回傳的結果未必同系列
 * （搜「鋼鐵人」會同時回「钢铁侠」和「钢铁巨人」），會產生「钢铁」這類
 * 無意義碎片，因此改為只處理第一筆。
 */
export function pickPrimaryAlias(aliases: string[]): string | null {
  if (aliases.length === 0) return null;

  const first = aliases[0];
  let trimmed = first;
  // 可能同時有副標題與集數，重複套用直到穩定
  for (let i = 0; i < 3; i++) {
    const next = trimmed.replace(TRAILING_NOISE_PATTERN, '').trim();
    if (next === trimmed) break;
    trimmed = next;
  }

  // 去尾綴後過短代表原標題本身就很短（或整串都是尾綴），退回原標題
  return trimmed.length >= 2 ? trimmed : first;
}

/**
 * 判斷別名是否值得用來重搜：與原查詢已經模糊匹配的話，
 * 代表原查詢本來就能命中，重搜只是浪費一輪請求。
 */
export function isAliasWorthRetrying(
  alias: string,
  originalQuery: string
): boolean {
  if (!alias) return false;
  const baseline = toSearchSimplified(
    convertTaiwanToMainland(cleanQueryForApi(originalQuery))
  ).trim();
  if (!baseline) return true;
  return !isFuzzyMatch(alias, baseline);
}
