const STORAGE_KEY = 'lunatv:chunk-reload-at';
const RELOAD_LOCK_MS = 10_000;

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const name = error instanceof Error ? error.name : '';
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  return (
    name === 'ChunkLoadError' ||
    /ChunkLoadError/i.test(message) ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

/**
 * Docker 更新後舊 JS chunk 404：清掉 SW／Cache Storage 再硬重新整理一次。
 * sessionStorage 加鎖，避免壞掉的頁面無限重整。
 */
export async function reloadOnceForStaleChunk(
  reloadPage: () => void = () => {
    window.location.reload();
  }
): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const last = Number(sessionStorage.getItem(STORAGE_KEY) || 0);
    if (
      Number.isFinite(last) &&
      last > 0 &&
      Date.now() - last < RELOAD_LOCK_MS
    ) {
      return false;
    }
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    return false;
  }

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations.map((registration) => registration.unregister())
      );
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    // 清快取失敗仍繼續重整
  }

  reloadPage();
  return true;
}
