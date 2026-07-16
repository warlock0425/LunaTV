export interface BangumiAliasCacheEntry {
  aliases: string[];
  expiresAt: number;
}

export const BANGUMI_ALIAS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function isFreshBangumiAliasCacheEntry(
  entry: BangumiAliasCacheEntry | null,
  now = Date.now()
): entry is BangumiAliasCacheEntry {
  return Boolean(entry && entry.expiresAt > now);
}
