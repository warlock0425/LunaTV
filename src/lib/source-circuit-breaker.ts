import { setBoundedMapValue } from './bounded-map';

/**
 * 來源級熔斷器：
 * - 某來源「連續」逾時／網路失敗達到門檻後進入冷卻期，
 *   期間所有對該來源的搜尋直接跳過，避免死源拖慢整體搜尋。
 * - 冷卻期滿後放行一個探測請求（half-open）：成功即重置、
 *   再失敗則立刻重新進入冷卻。
 * - 只計「逾時／連線失敗」，不計「查無結果」與 403
 *   （403 已由 search-cache 的負快取處理）。
 */

const FAILURE_THRESHOLD = (() => {
  const configured = Number(process.env.SOURCE_BREAKER_THRESHOLD);
  return Number.isFinite(configured) && configured > 0 ? configured : 3;
})();

const COOLDOWN_MS = (() => {
  const configured = Number(process.env.SOURCE_BREAKER_COOLDOWN_MINUTES);
  return (
    (Number.isFinite(configured) && configured > 0 ? configured : 10) *
    60 *
    1000
  );
})();

const MAX_TRACKED_SOURCES = 500;

interface BreakerState {
  consecutiveFailures: number;
  /** 冷卻期截止時間；0 表示未熔斷 */
  openUntil: number;
  /** half-open：冷卻期滿後已放行一個探測請求 */
  probing: boolean;
}

const breakerStates: Map<string, BreakerState> = new Map();

function getState(sourceKey: string): BreakerState {
  let state = breakerStates.get(sourceKey);
  if (!state) {
    state = { consecutiveFailures: 0, openUntil: 0, probing: false };
    setBoundedMapValue(breakerStates, sourceKey, state, MAX_TRACKED_SOURCES);
  }
  return state;
}

/**
 * 該來源目前是否應被跳過。
 * 冷卻期滿後的第一次呼叫會回傳 false（放行探測請求）並標記 probing。
 */
export function isSourceTripped(sourceKey: string): boolean {
  const state = breakerStates.get(sourceKey);
  if (!state || state.openUntil === 0) return false;

  if (Date.now() >= state.openUntil) {
    if (!state.probing) {
      state.probing = true;
      return false; // half-open：放行一個探測請求
    }
    // 探測請求尚未回報結果，其餘請求仍跳過
    return true;
  }
  return true;
}

export function recordSourceSuccess(sourceKey: string): void {
  const state = breakerStates.get(sourceKey);
  if (!state) return;
  state.consecutiveFailures = 0;
  state.openUntil = 0;
  state.probing = false;
}

export function recordSourceFailure(sourceKey: string): void {
  const state = getState(sourceKey);
  state.consecutiveFailures += 1;

  if (state.probing) {
    // 探測失敗：立刻重新進入冷卻
    state.openUntil = Date.now() + COOLDOWN_MS;
    state.probing = false;
    return;
  }

  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + COOLDOWN_MS;
    state.probing = false;
  }
}

/** 目前熔斷中的來源清單（供健康頁／日誌） */
export function getTrippedSources(): Array<{
  sourceKey: string;
  openUntil: number;
  consecutiveFailures: number;
}> {
  const now = Date.now();
  const result: Array<{
    sourceKey: string;
    openUntil: number;
    consecutiveFailures: number;
  }> = [];
  breakerStates.forEach((state, sourceKey) => {
    if (state.openUntil > now) {
      result.push({
        sourceKey,
        openUntil: state.openUntil,
        consecutiveFailures: state.consecutiveFailures,
      });
    }
  });
  return result;
}

/** 測試用：清空全部熔斷狀態 */
export function resetAllBreakers(): void {
  breakerStates.clear();
}
