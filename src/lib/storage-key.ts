export interface ParsedStorageKey {
  source: string;
  id: string;
}

export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`;
}

export function parseStorageKey(key?: string | null): ParsedStorageKey | null {
  if (!key) return null;

  const plusIndex = key.indexOf('+');
  if (plusIndex <= 0) return null;

  const source = key.slice(0, plusIndex);
  const id = key.slice(plusIndex + 1);
  if (!source || !id) return null;

  return { source, id };
}
