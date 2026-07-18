export const STREAMING_SEARCH_STORAGE_KEY = 'streamingSearchOutput';
export const LEGACY_STREAMING_SEARCH_STORAGE_KEY = 'fluidSearch';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;

function parseStoredBoolean(value: string | null): boolean | undefined {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

export function readStreamingSearchPreference(
  storage: ReadableStorage,
  fallback: boolean
): boolean {
  const currentValue = parseStoredBoolean(
    storage.getItem(STREAMING_SEARCH_STORAGE_KEY)
  );
  if (currentValue !== undefined) return currentValue;

  const legacyValue = parseStoredBoolean(
    storage.getItem(LEGACY_STREAMING_SEARCH_STORAGE_KEY)
  );
  return legacyValue ?? fallback;
}

export function writeStreamingSearchPreference(
  storage: WritableStorage,
  value: boolean
) {
  storage.setItem(STREAMING_SEARCH_STORAGE_KEY, String(value));
  storage.removeItem(LEGACY_STREAMING_SEARCH_STORAGE_KEY);
}

export function clearStreamingSearchPreference(storage: WritableStorage) {
  storage.removeItem(STREAMING_SEARCH_STORAGE_KEY);
  storage.removeItem(LEGACY_STREAMING_SEARCH_STORAGE_KEY);
}
