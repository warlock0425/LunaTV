import { toSearchSimplified } from './chinese';
import { convertS2T, convertT2S } from './s2t';
import { parseStorageKey } from './storage-key';
import { normalizePlayRecordTitle, normalizeTitle } from './string-utils';

export type PlayRecordLike = {
  key?: string;
  title?: string;
  vod_name?: string;
  source_name?: string;
  source?: string;
  id?: string;
  vod_id?: string;
  save_time?: number;
  search_title?: string;
  year?: string;
};

function getDirectIdentity(record: PlayRecordLike): string {
  const parsedKey = parseStorageKey(record.key);
  const source = record.source || parsedKey?.source || '';
  const id = record.vod_id || record.id || parsedKey?.id || '';

  return source && id ? `${source}+${id}` : '';
}

export function getPlayRecordIdentity(record: PlayRecordLike): string {
  const directIdentity = getDirectIdentity(record);
  if (directIdentity) return directIdentity;

  const title = record.title || record.vod_name || '';
  const normalizedTitle =
    normalizePlayRecordTitle(title) || convertS2T(title || '').trim();

  return normalizedTitle;
}

function normalizePlaybackIdentity(title?: string): string[] {
  const value = title || '';
  return [
    normalizePlayRecordTitle(value),
    normalizePlayRecordTitle(convertS2T(value)),
    normalizePlayRecordTitle(convertT2S(value)),
    normalizeTitle(value),
    normalizeTitle(convertS2T(value)),
    normalizeTitle(convertT2S(value)),
    normalizePlayRecordTitle(toSearchSimplified(value)),
    normalizeTitle(toSearchSimplified(value)),
  ].filter(Boolean);
}

function getPlaybackIdentities(record: PlayRecordLike): string[] {
  return Array.from(
    new Set(
      [record.search_title, record.title, record.vod_name].flatMap((title) =>
        normalizePlaybackIdentity(title)
      )
    )
  );
}

function getRecordYear(record: PlayRecordLike): string {
  return String(record.year || '').replace(/\D/g, '');
}

function yearsCompatible(a: PlayRecordLike, b: PlayRecordLike): boolean {
  const yearA = getRecordYear(a);
  const yearB = getRecordYear(b);
  if (!yearA || !yearB || yearA === '0' || yearB === '0') return true;
  return yearA === yearB;
}

export function hydratePlayRecord<T extends PlayRecordLike>(
  record: T
): T & { source: string; id: string; vod_name: string; vod_id: string } {
  const parsedKey = parseStorageKey(record.key);
  const id = record.vod_id || record.id || parsedKey?.id || '';
  const source = record.source || parsedKey?.source || '';

  return {
    ...record,
    vod_name: record.title || record.vod_name || '',
    vod_id: id,
    id,
    source,
  };
}

export function deduplicatePlayRecordList<T extends PlayRecordLike>(
  records: T[]
): T[] {
  const sorted = [...records].sort(
    (a, b) => Number(b.save_time || 0) - Number(a.save_time || 0)
  );
  const latestByIdentity = new Map<string, T>();

  for (const record of sorted) {
    if (!record || !(record.title || record.vod_name)) continue;
    const identity = getPlayRecordIdentity(record);
    if (!identity || identity === '_') continue;
    const existing = latestByIdentity.get(identity);
    if (
      !existing ||
      Number(record.save_time || 0) >= Number(existing.save_time || 0)
    ) {
      latestByIdentity.set(identity, record);
    }
  }

  return Array.from(latestByIdentity.values()).sort(
    (a, b) => Number(b.save_time || 0) - Number(a.save_time || 0)
  );
}

export function getPlayRecordKeysByIdentity<T extends PlayRecordLike>(
  records: T[],
  target: PlayRecordLike
): string[] {
  const targetDirectIdentity = getDirectIdentity(target);
  const targetIdentity = getPlayRecordIdentity(target);

  return records
    .filter((record) => {
      const recordDirectIdentity = getDirectIdentity(record);
      if (targetDirectIdentity) {
        return recordDirectIdentity === targetDirectIdentity;
      }
      return (
        !recordDirectIdentity &&
        getPlayRecordIdentity(record) === targetIdentity
      );
    })
    .map((record) => record.key)
    .filter((key): key is string => Boolean(key));
}

export function getPlayRecordKeysToReplace<T extends PlayRecordLike>(
  records: Record<string, T>,
  target: T
): string[] {
  const targetDirectIdentity = getDirectIdentity(target);
  const targetPlaybackIdentities = getPlaybackIdentities(target);

  return Object.entries(records || {})
    .filter(([key, record]) => {
      if (!record) return false;
      const candidate = { ...record, key };
      const directIdentity = getDirectIdentity(candidate);
      if (targetDirectIdentity && directIdentity === targetDirectIdentity) {
        return true;
      }

      if (
        targetPlaybackIdentities.length === 0 ||
        !yearsCompatible(candidate, target)
      ) {
        return false;
      }

      const playbackIdentities = getPlaybackIdentities(candidate);
      return playbackIdentities.some((identity) =>
        targetPlaybackIdentities.includes(identity)
      );
    })
    .map(([key]) => key);
}
