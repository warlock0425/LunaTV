export const DEFAULT_SITE_NAME = 'LunaTV';

const LEGACY_DEFAULT_SITE_NAMES = new Set(['MoonTV', 'BerserkerTV']);

export function isLegacyDefaultSiteName(name: string): boolean {
  return LEGACY_DEFAULT_SITE_NAMES.has(name);
}

export function resolveSiteName(
  current?: string | null,
  envName = process.env.NEXT_PUBLIC_SITE_NAME
): string {
  const fromEnv = envName?.trim();
  if (fromEnv) return fromEnv;
  const trimmed = current?.trim();
  if (!trimmed || isLegacyDefaultSiteName(trimmed)) return DEFAULT_SITE_NAME;
  return trimmed;
}
