export interface CronHealthStatus {
  running: boolean;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
}

const globalCronHealth = globalThis as typeof globalThis & {
  __berserkerCronHealth?: CronHealthStatus;
};

function state(): CronHealthStatus {
  globalCronHealth.__berserkerCronHealth ??= {
    running: false,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSuccessAt: null,
    lastError: null,
  };
  return globalCronHealth.__berserkerCronHealth;
}

export function markCronStarted(startedAt: string): void {
  Object.assign(state(), {
    running: true,
    lastStartedAt: startedAt,
    lastError: null,
  });
}

export function markCronCompleted(error?: unknown): void {
  const completedAt = new Date().toISOString();
  Object.assign(state(), {
    running: false,
    lastCompletedAt: completedAt,
    lastSuccessAt: error ? state().lastSuccessAt : completedAt,
    lastError: error
      ? error instanceof Error
        ? error.message
        : 'Unknown error'
      : null,
  });
}

export function getCronHealthStatus(): CronHealthStatus {
  return { ...state() };
}
