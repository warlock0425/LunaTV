import { getSearchOutboundCap } from './search-runtime';

let active = 0;
const waiters: Array<() => void> = [];

export function resetOutboundGateForTests(): void {
  active = 0;
  waiters.splice(0, waiters.length);
}

export function getOutboundGateActiveForTests(): number {
  return active;
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function acquire(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());

  if (active < getSearchOutboundCap()) {
    active += 1;
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const abortFromSignal = () => {
      const index = waiters.indexOf(tryEnter);
      if (index >= 0) waiters.splice(index, 1);
      signal?.removeEventListener('abort', abortFromSignal);
      reject(abortError());
    };

    const tryEnter = () => {
      if (signal?.aborted) {
        abortFromSignal();
        return;
      }
      if (active >= getSearchOutboundCap()) {
        waiters.push(tryEnter);
        return;
      }
      signal?.removeEventListener('abort', abortFromSignal);
      active += 1;
      resolve();
    };

    signal?.addEventListener('abort', abortFromSignal, { once: true });
    waiters.push(tryEnter);
  });
}

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

/** 搜尋打 CMS 時佔一個 outbound 名額；熱路徑共用，避免 48 源同時出站。 */
export async function withOutboundSlot<T>(
  work: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  await acquire(signal);
  try {
    return await work();
  } finally {
    release();
  }
}
