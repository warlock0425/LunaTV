import { setBoundedMapValue } from './bounded-map';

const DEFAULT_ALIAS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ALIAS_CACHE_ENTRIES = 500;
const ALIAS_FETCH_TIMEOUT_MS = 10000;

type AliasCacheEntry = {
  aliases: string[];
  expiresAt: number;
};

const memoryCache = new Map<number, AliasCacheEntry>();
const inFlight = new Map<number, Promise<void>>();

function isValidBangumiId(bgmId: number): boolean {
  return Number.isInteger(bgmId) && bgmId > 0;
}

function cleanAliases(aliases: string[]): string[] {
  return Array.from(
    new Set(
      aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0)
    )
  );
}

export function getCachedBangumiAliases(bgmId: number): string[] | null {
  if (!isValidBangumiId(bgmId)) return null;

  const cached = memoryCache.get(bgmId);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    memoryCache.delete(bgmId);
    return null;
  }

  return [...cached.aliases];
}

export function setCachedBangumiAliases(
  bgmId: number,
  aliases: string[],
  ttlMs = DEFAULT_ALIAS_CACHE_TTL_MS
): void {
  if (!isValidBangumiId(bgmId) || ttlMs <= 0) return;

  const cleanedAliases = cleanAliases(aliases);
  setBoundedMapValue(
    memoryCache,
    bgmId,
    {
      aliases: cleanedAliases,
      expiresAt: Date.now() + ttlMs,
    },
    MAX_ALIAS_CACHE_ENTRIES
  );
}

export async function warmBangumiAliases(bgmId: number): Promise<void> {
  if (!isValidBangumiId(bgmId) || getCachedBangumiAliases(bgmId)) return;

  const pending = inFlight.get(bgmId);
  if (pending) return pending;

  const task = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      ALIAS_FETCH_TIMEOUT_MS
    );

    try {
      const params = new URLSearchParams({ id: String(bgmId) });
      const response = await fetch(
        `/api/bangumi/aliases?${params.toString()}`,
        { signal: controller.signal }
      );
      if (!response.ok) return;

      const data = (await response.json()) as { aliases?: unknown };
      if (!Array.isArray(data.aliases)) return;

      setCachedBangumiAliases(
        bgmId,
        data.aliases.filter(
          (alias): alias is string => typeof alias === 'string'
        )
      );
    } catch {
      // Best-effort cache warming must never affect the caller.
    } finally {
      clearTimeout(timeoutId);
      inFlight.delete(bgmId);
    }
  })();

  inFlight.set(bgmId, task);
  return task;
}
