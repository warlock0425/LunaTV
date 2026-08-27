export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  options?: {
    signal?: AbortSignal;
    skipped?: (item: T, index: number) => R;
  }
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      if (options?.signal?.aborted && options.skipped) {
        results[index] = options.skipped(items[index], index);
        continue;
      }
      results[index] = await worker(items[index], index);
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

export function createLinkedAbortController(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();

  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const cleanup = () => {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', abortFromParent);
  };

  return { controller, cleanup };
}
