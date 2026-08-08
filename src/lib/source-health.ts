import { setBoundedMapValue } from './bounded-map';
import type { ApiSite } from './config';
import {
  getSourceBreakerOpenUntil,
  isSourceInCooldown,
} from './source-circuit-breaker';

type HealthState = {
  averageMs: number;
  samples: number;
  consecutiveTimeouts: number;
  disabledUntil: number;
};

const states = new Map<string, HealthState>();
const CIRCUIT_TIMEOUTS = 3;
const CIRCUIT_OPEN_MS = 10 * 60 * 1000;
const MAX_HEALTH_STATES = 1000;

function stateFor(key: string): HealthState {
  const existing = states.get(key);
  if (existing) return existing;
  const created = {
    averageMs: 1500,
    samples: 0,
    consecutiveTimeouts: 0,
    disabledUntil: 0,
  };
  setBoundedMapValue(states, key, created, MAX_HEALTH_STATES);
  return created;
}

/** 該源最早可再被選中的時間（health 熔斷與 breaker 冷卻取較晚者） */
function unavailableUntil(sourceKey: string, now: number): number {
  const healthUntil = stateFor(sourceKey).disabledUntil;
  const breakerUntil = getSourceBreakerOpenUntil(sourceKey);
  return Math.max(
    healthUntil > now ? healthUntil : 0,
    breakerUntil > now ? breakerUntil : 0
  );
}

function isSourceUnavailableForOrdering(
  sourceKey: string,
  now: number
): boolean {
  return (
    stateFor(sourceKey).disabledUntil > now ||
    isSourceInCooldown(sourceKey, now)
  );
}

export function orderSourcesByHealth(sites: ApiSite[]): ApiSite[] {
  const now = Date.now();
  const sorted = [...sites].sort((a, b) => {
    const left = stateFor(a.key);
    const right = stateFor(b.key);
    if (left.samples === 0 && right.samples > 0) return -1;
    if (right.samples === 0 && left.samples > 0) return 1;
    return left.averageMs - right.averageMs;
  });
  // health 自熔斷 或 breaker 冷卻中 → 不進排序結果（避免死源被假 ~1ms 推到第一）
  // 注意：只用 isSourceInCooldown（純讀），禁止 isSourceTripped（會消耗半開探測名額）
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
  timedOut: boolean
): void {
  const state = stateFor(sourceKey);
  state.averageMs =
    state.samples === 0
      ? durationMs
      : Math.round(state.averageMs * 0.75 + durationMs * 0.25);
  state.samples++;

  if (timedOut) {
    state.consecutiveTimeouts++;
    if (state.consecutiveTimeouts >= CIRCUIT_TIMEOUTS) {
      state.disabledUntil = Date.now() + CIRCUIT_OPEN_MS;
      state.consecutiveTimeouts = 0;
    }
  } else {
    state.consecutiveTimeouts = 0;
  }
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
    .map(([key, state]) => ({
      key,
      averageMs: state.averageMs,
      samples: state.samples,
      consecutiveTimeouts: state.consecutiveTimeouts,
      disabledUntil: state.disabledUntil,
      disabled: state.disabledUntil > now,
    }))
    .sort((a, b) => b.samples - a.samples || a.averageMs - b.averageMs);
}

export function resetSourceHealth(sourceKey?: string): void {
  if (!sourceKey) {
    states.clear();
    return;
  }
  states.delete(sourceKey);
}
