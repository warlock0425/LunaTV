const pendingRequests = new Map<string, Promise<unknown>>();

export function deduplicateRequest<T>(
  key: string,
  factory: () => Promise<T>,
  timeoutMs = 30000
): Promise<T> {
  const existing = pendingRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`deduplicateRequest timeout: ${key}`)),
      timeoutMs
    );
  });

  let requestPromise: Promise<T>;
  try {
    requestPromise = factory();
  } catch (error) {
    requestPromise = Promise.reject(error);
  }
  const promise = Promise.race([requestPromise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
    pendingRequests.delete(key);
  }) as Promise<T>;

  pendingRequests.set(key, promise);
  return promise;
}

export function getActiveRequestCount(): number {
  return pendingRequests.size;
}
