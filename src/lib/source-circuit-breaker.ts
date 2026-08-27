import { setBoundedMapValue } from './bounded-map';
import { getRuntimeKv, withRuntimeKvBudget } from './runtime-kv';

/**
 * 來源級熔斷器：
 * - 某來源「連續」逾時／網路失敗達到門檻後進入冷卻期，
 *   期間所有對該來源的搜尋直接跳過，避免死源拖慢整體搜尋。
 * - 冷卻期滿後放行一個探測請求（half-open）：成功即重置、
 *   再失敗則立刻重新進入冷卻。
 * - 只計「逾時／連線失敗」，不計「查無結果」與 403
 *   （403 已由 search-cache 的負快取處理）。
 * - skip 決策只走這裡；source-health 只做 EWMA 排序。
 * - 有 Kvrocks／Redis 時整批 HGETALL + 本地 TTL，不在每源搜尋前多一趟。
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
const BREAKER_HASH_KEY = 'lunatv:source-breaker';
const LOCAL_HYDRATE_TTL_MS = 5_000;

interface BreakerState {
  consecutiveFailures: number;
  /** 冷卻期截止時間；0 表示未熔斷 */
  openUntil: number;
  /** half-open：冷卻期滿後已放行一個探測請求 */
  probing: boolean;
}

type StoredBreaker = {
  consecutiveFailures: number;
  openUntil: number;
};

const breakerStates: Map<string, BreakerState> = new Map();
let lastHydratedAt = 0;

function getState(sourceKey: string): BreakerState {
  let state = breakerStates.get(sourceKey);
  if (!state) {
    state = { consecutiveFailures: 0, openUntil: 0, probing: false };
    setBoundedMapValue(breakerStates, sourceKey, state, MAX_TRACKED_SOURCES);
  }
  return state;
}

function persistField(sourceKey: string, state: BreakerState): void {
  const kv = getRuntimeKv();
  if (!kv) return;
  const ttlSeconds = Math.max(1, Math.ceil(COOLDOWN_MS / 1000));
  void kv
    .hSet(
      BREAKER_HASH_KEY,
      sourceKey,
      JSON.stringify({
        consecutiveFailures: state.consecutiveFailures,
        openUntil: state.openUntil,
      } satisfies StoredBreaker)
    )
    .then(() => kv.expire(BREAKER_HASH_KEY, ttlSeconds))
    .catch(() => undefined);
}

function deletePersistedField(sourceKey: string): void {
  const kv = getRuntimeKv();
  if (!kv) return;
  void kv.hDel(BREAKER_HASH_KEY, sourceKey).catch(() => undefined);
}

function deletePersistedHash(): void {
  const kv = getRuntimeKv();
  if (!kv) return;
  void kv.del(BREAKER_HASH_KEY).catch(() => undefined);
}

/**
 * 搜尋開始時整批灌入本地狀態。本地 5s 內不重複打 Redis。
 */
export async function hydrateBreakersFromStore(): Promise<void> {
  const now = Date.now();
  if (now - lastHydratedAt < LOCAL_HYDRATE_TTL_MS) return;

  const stored = await withRuntimeKvBudget(
    (kv) => kv.hGetAll(BREAKER_HASH_KEY),
    {} as Record<string, string>
  );
  lastHydratedAt = Date.now();

  for (const [sourceKey, raw] of Object.entries(stored)) {
    if (!raw) continue;
    let parsed: StoredBreaker | null = null;
    try {
      parsed = JSON.parse(raw) as StoredBreaker;
    } catch {
      continue;
    }
    if (
      !parsed ||
      typeof parsed.openUntil !== 'number' ||
      typeof parsed.consecutiveFailures !== 'number'
    ) {
      continue;
    }
    const existing = breakerStates.get(sourceKey);
    // 本行程正在探測、或本地冷卻更新，不要被舊快照蓋掉
    if (existing?.probing) continue;
    if (existing && existing.openUntil >= parsed.openUntil) continue;
    if (parsed.openUntil <= now) continue;

    setBoundedMapValue(
      breakerStates,
      sourceKey,
      {
        consecutiveFailures: parsed.consecutiveFailures,
        openUntil: parsed.openUntil,
        probing: false,
      },
      MAX_TRACKED_SOURCES
    );
  }
}

/**
 * 純讀：來源是否仍在 breaker 冷卻期內（不改 probing）。
 * 供排序等唯讀情境使用。放行半開探測請一律走 isSourceTripped。
 */
export function isSourceInCooldown(
  sourceKey: string,
  now = Date.now()
): boolean {
  const state = breakerStates.get(sourceKey);
  if (!state || state.openUntil === 0) return false;
  return now < state.openUntil;
}

/** 純讀：冷卻截止時間（0 表示未熔斷）。供排序挑「最快恢復」候選用。 */
export function getSourceBreakerOpenUntil(sourceKey: string): number {
  return breakerStates.get(sourceKey)?.openUntil ?? 0;
}

/**
 * 該來源目前是否應被跳過。
 * 冷卻期滿後的第一次呼叫會回傳 false（放行探測請求）並標記 probing。
 * ⚠️ 有副作用（會消耗半開探測名額）——排序／唯讀路徑禁止呼叫此函式。
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
  deletePersistedField(sourceKey);
}

export function recordSourceFailure(sourceKey: string): void {
  const state = getState(sourceKey);
  state.consecutiveFailures += 1;

  if (state.probing) {
    // 探測失敗：立刻重新進入冷卻
    state.openUntil = Date.now() + COOLDOWN_MS;
    state.probing = false;
    persistField(sourceKey, state);
    return;
  }

  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + COOLDOWN_MS;
    state.probing = false;
    persistField(sourceKey, state);
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

/** 重置單一來源熔斷狀態 */
export function resetSourceBreaker(sourceKey: string): void {
  breakerStates.delete(sourceKey);
  deletePersistedField(sourceKey);
}

/** 測試用：清空全部熔斷狀態 */
export function resetAllBreakers(): void {
  breakerStates.clear();
  lastHydratedAt = 0;
  deletePersistedHash();
}
