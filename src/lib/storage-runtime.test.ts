import {
  getServerStorageType,
  getStorageRuntimeStatus,
} from './storage-runtime';

describe('storage-runtime', () => {
  it('defaults to localstorage for missing or unknown storage type', () => {
    expect(getServerStorageType({})).toBe('localstorage');
    expect(getServerStorageType({ STORAGE_TYPE: 'unknown' })).toBe(
      'localstorage'
    );
  });

  it('prefers STORAGE_TYPE over NEXT_PUBLIC_STORAGE_TYPE', () => {
    expect(
      getServerStorageType({
        STORAGE_TYPE: 'redis',
        NEXT_PUBLIC_STORAGE_TYPE: 'kvrocks',
      })
    ).toBe('redis');
  });

  it('reports redis missing env clearly', () => {
    expect(getStorageRuntimeStatus({ STORAGE_TYPE: 'redis' })).toEqual({
      type: 'redis',
      configured: false,
      message: 'Missing required env: REDIS_URL',
      missing: ['REDIS_URL'],
    });
  });

  it('reports upstash missing env clearly', () => {
    expect(
      getStorageRuntimeStatus({
        STORAGE_TYPE: 'upstash',
        UPSTASH_URL: 'https://example.upstash.io',
      })
    ).toEqual({
      type: 'upstash',
      configured: false,
      message: 'Missing required env: UPSTASH_TOKEN',
      missing: ['UPSTASH_TOKEN'],
    });
  });

  it('reports kvrocks configured when KVROCKS_URL exists', () => {
    expect(
      getStorageRuntimeStatus({
        STORAGE_TYPE: 'kvrocks',
        KVROCKS_URL: 'redis://localhost:6666',
      })
    ).toEqual({
      type: 'kvrocks',
      configured: true,
      message: 'Kvrocks storage configured',
      missing: [],
    });
  });
});
