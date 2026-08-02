/**
 * 搜尋歷史的資料一致性路徑。
 *
 * 這支與 favorites / skip-configs 不同：addSearchHistory 是用
 * `[trimmed, ...filter()]` 建新陣列，沒有就地改動快取活引用的問題。它的風險在
 * 另外兩處——去重與長度上限（寫錯會讓歷史無限膨脹或把最新的擠掉），以及寫入
 * 失敗後的狀態。
 */

jest.mock('../auth', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'test-user' }),
}));

const CACHE_KEY = 'moontv_cache_test-user';
const LIMIT = 20; // 對齊 shared.ts 的 SEARCH_HISTORY_LIMIT

function seedCache(data: string[]) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      searchHistory: { data, timestamp: Date.now(), version: '1.0.0' },
    })
  );
}

function readCached(): string[] {
  const raw = localStorage.getItem(CACHE_KEY);
  return raw ? JSON.parse(raw).searchHistory.data : [];
}

function loadModule() {
  return jest.requireActual<typeof import('./search-history')>(
    './search-history'
  );
}

function setFetch(mock: jest.Mock) {
  (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = mock;
}

const okFetch = (getBody: unknown) =>
  jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') return { ok: true, status: 200 };
    return { ok: true, status: 200, json: async () => getBody };
  });

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('搜尋歷史', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (
      window as typeof window & { RUNTIME_CONFIG?: { STORAGE_TYPE: string } }
    ).RUNTIME_CONFIG = { STORAGE_TYPE: 'kvrocks' };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'fetch');
    Reflect.deleteProperty(
      window as typeof window & { RUNTIME_CONFIG?: unknown },
      'RUNTIME_CONFIG'
    );
  });

  it('重複的關鍵字移到最前面，不產生第二筆', async () => {
    seedCache(['甲', '乙', '丙']);
    setFetch(okFetch(['甲', '乙', '丙']));

    const { addSearchHistory } = loadModule();
    await addSearchHistory('丙');
    await flush();

    expect(readCached()).toEqual(['丙', '甲', '乙']);
  });

  it('超過上限時砍掉最舊的，而不是擋掉最新的', async () => {
    const existing = Array.from({ length: LIMIT }, (_, i) => `舊${i}`);
    seedCache(existing);
    setFetch(okFetch(existing));

    const { addSearchHistory } = loadModule();
    await addSearchHistory('最新');
    await flush();

    const cached = readCached();
    expect(cached).toHaveLength(LIMIT);
    expect(cached[0]).toBe('最新');
    expect(cached).not.toContain(`舊${LIMIT - 1}`);
  });

  it('前後空白會被去除，且不因空白差異產生重複', async () => {
    seedCache(['甲']);
    setFetch(okFetch(['甲']));

    const { addSearchHistory } = loadModule();
    await addSearchHistory('  甲  ');
    await flush();

    expect(readCached()).toEqual(['甲']);
  });

  it('空字串不寫入歷史', async () => {
    seedCache(['甲']);
    const fetchMock = okFetch(['甲']);
    setFetch(fetchMock);

    const { addSearchHistory } = loadModule();
    await addSearchHistory('   ');
    await flush();

    expect(readCached()).toEqual(['甲']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // 與 favorites / skip-configs 的刻意差異：那兩支會把錯誤往上拋，這支不會——
  // 搜尋歷史寫不進去不該中斷使用者正在進行的搜尋。錯誤只做回滾與兜底重整。
  it('寫入失敗時不向上拋錯，但快取要回到伺服器權威狀態', async () => {
    seedCache(['甲']);
    setFetch(
      jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') throw new Error('network down');
        return { ok: true, status: 200, json: async () => ['甲'] };
      })
    );

    const { addSearchHistory } = loadModule();

    await expect(addSearchHistory('乙')).resolves.toBeUndefined();
    await flush();

    expect(readCached()).toEqual(['甲']);
  });

  it('刪除單筆只影響該筆', async () => {
    seedCache(['甲', '乙', '丙']);
    setFetch(okFetch(['甲', '乙', '丙']));

    const { deleteSearchHistory } = loadModule();
    await deleteSearchHistory('乙');
    await flush();

    expect(readCached()).toEqual(['甲', '丙']);
  });
});
