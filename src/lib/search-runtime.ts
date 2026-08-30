/** 搜尋熱路徑可調參數。預設以找齊片源為準。 */

function envInt(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

/** 同時搜幾條源。 */
export function getSearchSourceConcurrency(): number {
  return envInt('SEARCH_SOURCE_CONCURRENCY', 12, 1, 24);
}

/** 全站搜尋 outbound 同時進行中的 CMS 請求上限。 */
export function getSearchOutboundCap(): number {
  return envInt('SEARCH_OUTBOUND_CAP', 32, 1, 64);
}

/** 前 K 個「有結果」的源後截止，其餘 abort。 */
export function getSearchSuccessSourceCutoff(): number {
  return envInt('SEARCH_SUCCESS_SOURCE_CUTOFF', 64, 1, 64);
}

/** 單次搜尋總 deadline（毫秒）。 */
export function getSearchDeadlineMs(): number {
  return envInt('SEARCH_DEADLINE_MS', 20000, 2000, 30000);
}

/** 熱路徑每個源最多打幾個查詢變體。陸源譯名常靠第 2 個才命中。 */
export function getSearchHotPathMaxVariants(): number {
  return envInt('SEARCH_HOT_PATH_MAX_VARIANTS', 3, 1, 6);
}

/** 單頁 CMS 逾時。 */
export function getSearchPageTimeoutMs(): number {
  return envInt('SEARCH_PAGE_TIMEOUT_MS', 5000, 1500, 12000);
}

/** EWMA 低於此值視為「已測且快」，排序時排在未知源前面。 */
export const SEARCH_HEALTH_FAST_MS = 2500;
