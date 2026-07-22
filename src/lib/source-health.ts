import { setBoundedMapValue } from './bounded-map';
import type { ApiSite } from './config';

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

export function orderSourcesByHealth(sites: ApiSite[]): ApiSite[] {
  const now = Date.now();
  const sorted = [...sites].sort((a, b) => {
    const left = stateFor(a.key);
    const right = stateFor(b.key);
    if (left.samples === 0 && right.samples > 0) return -1;
    if (right.samples === 0 && left.samples > 0) return 1;
    return left.averageMs - right.averageMs;
  });
  const available = sorted.filter(
    (site) => stateFor(site.key).disabledUntil <= now
  );
  if (available.length > 0 || sorted.length === 0) return available;

  // Keep one source in half-open mode so a temporary upstream outage cannot
  // suppress every result for the full circuit-breaker window.
  return [
    sorted.reduce((candidate, site) =>
      stateFor(site.key).disabledUntil < stateFor(candidate.key).disabledUntil
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
