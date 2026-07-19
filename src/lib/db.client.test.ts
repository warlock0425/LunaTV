jest.mock('./auth', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'test-user' }),
}));

const CACHE_KEY = 'moontv_cache_test-user';
const ORIGINAL_RECORD = {
  title: '原紀錄',
  source_name: '測試片源',
  year: '2026',
  cover: '',
  index: 1,
  total_episodes: 12,
  play_time: 10,
  total_time: 1200,
  save_time: 1,
};

describe('savePlayRecord remote synchronization', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    (
      window as typeof window & { RUNTIME_CONFIG?: { STORAGE_TYPE: string } }
    ).RUNTIME_CONFIG = { STORAGE_TYPE: 'kvrocks' };

    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        playRecords: {
          data: { 'old+1': ORIGINAL_RECORD },
          timestamp: Date.now(),
          version: '1.0.0',
        },
      })
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'fetch');
    Reflect.deleteProperty(
      window as typeof window & { RUNTIME_CONFIG?: unknown },
      'RUNTIME_CONFIG'
    );
  });

  it('keeps a successful save when only the follow-up refresh fails', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        clone: () => ({
          json: async () => ({ error: 'refresh unavailable' }),
        }),
      });
    (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;

    const globalErrors: string[] = [];
    const handleGlobalError = (event: Event) => {
      globalErrors.push(
        (event as CustomEvent<{ message: string }>).detail.message
      );
    };
    window.addEventListener('globalError', handleGlobalError);

    try {
      const { savePlayRecord } =
        jest.requireActual<typeof import('./db.client.js')>('./db.client');
      await expect(
        savePlayRecord('source', '2', {
          ...ORIGINAL_RECORD,
          title: '新紀錄',
          index: 2,
          play_time: 120,
          save_time: 2,
        })
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        '/api/playrecords',
        expect.objectContaining({ method: 'POST' })
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/playrecords',
        expect.objectContaining({ cache: 'no-store' })
      );
      expect(globalErrors).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        '播放紀錄已儲存，但重新整理播放紀錄快取失敗:',
        expect.any(Error)
      );

      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      expect(cache.playRecords.data['source+2']).toEqual(
        expect.objectContaining({
          title: '新紀錄',
          index: 2,
          play_time: 120,
        })
      );
    } finally {
      window.removeEventListener('globalError', handleGlobalError);
    }
  });
});
