import {
  clearStreamingSearchPreference,
  LEGACY_STREAMING_SEARCH_STORAGE_KEY,
  readStreamingSearchPreference,
  STREAMING_SEARCH_STORAGE_KEY,
  writeStreamingSearchPreference,
} from './streaming-search-preference';

describe('streaming search preference', () => {
  beforeEach(() => localStorage.clear());

  it('優先讀取目前 key，並兼容舊 key', () => {
    localStorage.setItem(LEGACY_STREAMING_SEARCH_STORAGE_KEY, 'false');
    expect(readStreamingSearchPreference(localStorage, true)).toBe(false);

    localStorage.setItem(STREAMING_SEARCH_STORAGE_KEY, 'true');
    expect(readStreamingSearchPreference(localStorage, false)).toBe(true);
  });

  it('儲存時移除舊 key，重設時清除兩個 key', () => {
    localStorage.setItem(LEGACY_STREAMING_SEARCH_STORAGE_KEY, 'false');
    writeStreamingSearchPreference(localStorage, true);

    expect(localStorage.getItem(STREAMING_SEARCH_STORAGE_KEY)).toBe('true');
    expect(
      localStorage.getItem(LEGACY_STREAMING_SEARCH_STORAGE_KEY)
    ).toBeNull();

    clearStreamingSearchPreference(localStorage);
    expect(localStorage.getItem(STREAMING_SEARCH_STORAGE_KEY)).toBeNull();
  });
});
