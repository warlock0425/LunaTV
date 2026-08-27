import { setBoundedMapValue } from './bounded-map';
import type { ApiSite } from './config';
import { SEARCH_HEALTH_FAST_MS } from './search-runtime';
import {
  getSourceBreakerOpenUntil,
  isSourceInCooldown,
} from './source-circuit-breaker';

type HealthState = {
  averageMs: number;
  samples: number;
};

const states = new Map<string, HealthState>();
const MAX_HEALTH_STATES = 1000;

function stateFor(key: string): HealthState {
  const existing = states.get(key);
  if (existing) return existing;
  const created = {
    averageMs: 1500,
    samples: 0,
  };
  setBoundedMapValue(states, key, created, MAX_HEALTH_STATES);
  return created;
}

/** skip 決策只看 circuit-breaker。health 只做 EWMA 排序。 */
function unavailableUntil(sourceKey: string, now: number): number {
  const breakerUntil = getSourceBreakerOpenUntil(sourceKey);
  return breakerUntil > now ? breakerUntil : 0;
}

function isSourceUnavailableForOrdering(
  sourceKey: string,
  now: number
): boolean {
  return isSourceInCooldown(sourceKey, now);
}

/**
 * 0 = 已測且快，1 = 未知（尚無樣本），2 = 已測但慢。
 * 未知源不可排最前，否則 cutoff 會先打一堆沒測過的死源。
 */
function healthBucket(state: HealthState): number {
  if (state.samples === 0) return 1;
  if (state.averageMs <= SEARCH_HEALTH_FAST_MS) return 0;
  return 2;
}

export function orderSourcesByHealth(sites: ApiSite[]): ApiSite[] {
  const now = Date.now();
  const sorted = [...sites].sort((a, b) => {
    const left = stateFor(a.key);
    const right = stateFor(b.key);
    const leftBucket = healthBucket(left);
    const rightBucket = healthBucket(right);
    if (leftBucket !== rightBucket) return leftBucket - rightBucket;
    if (leftBucket === 1) return a.key.localeCompare(b.key);
    return left.averageMs - right.averageMs;
  });
  // breaker 冷卻中不進排序結果。只用 isSourceInCooldown（純讀），
  // 禁止 isSourceTripped（會消耗半開探測名額）。
  const available = sorted.filter(
    (site) => !isSourceUnavailableForOrdering(site.key, now)
  );
  if (available.length > 0 || sorted.length === 0) return available;

  // 全部不可用時留一個「最快恢復」的半開候選，避免短暫全抖動時搜尋全空
  return [
    sorted.reduce((candidate, site) =>
      unavailableUntil(site.key, now) < unavailableUntil(candidate.key, now)
        ? site
        : candidate
    ),
  ];
}

export function recordSourceSearch(
  sourceKey: string,
  durationMs: number,
  _timedOut: boolean
): void {
  const state = stateFor(sourceKey);
  state.averageMs =
    state.samples === 0
      ? durationMs
      : Math.round(state.averageMs * 0.75 + durationMs * 0.25);
  state.samples++;
}

export function clearSourceHealthForTests(): void {
  states.clear();
}

export interface SourceHealthSnapshot {
  key: string;
  averageMs: number;
  samples: number;
  consecutiveTimeouts: number;
  disabledUntil: number;
  disabled: boolean;
}

export function getSourceHealthSnapshots(
  now = Date.now()
): SourceHealthSnapshot[] {
  return Array.from(states.entries())
    .map(([key, state]) => {
      const disabledUntil = getSourceBreakerOpenUntil(key);
      return {
        key,
        averageMs: state.averageMs,
        samples: state.samples,
        consecutiveTimeouts: 0,
        disabledUntil,
        disabled: disabledUntil > now,
      };
    })
    .sort((a, b) => b.samples - a.samples || a.averageMs - b.averageMs);
}

export function resetSourceHealth(sourceKey?: string): void {
  if (!sourceKey) {
    states.clear();
    return;
  }
  states.delete(sourceKey);
}
