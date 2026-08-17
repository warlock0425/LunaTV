/**
 * 收藏的靜默資料遺失路徑。
 *
 * 這支檔案出過一次事：d4ef76f 修的 `delete cachedFavorites[key]` 就地刪改了
 * cacheManager 回傳的活引用，讓記憶體與實際儲存內容不一致。那次是靠人工盤點
 * 抓到的，修完也沒有留下任何測試——同一批被修的三個檔案裡，只有 play-records
 * 後來補了測試。
 *
 * 這裡鎖住的是「使用者的收藏不會無聲消失」，不做全量 CRUD 覆蓋。
 */

jest.mock('../auth', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'test-user' }),
}));

const CACHE_KEY = 'moontv_cache_test-user';

const FAV_A = {
  title: '影片 A',
  source_name: '測試片源',
  year: '2026',
  cover: '',
  total_episodes: 12,
  save_time: 1,
};

const FAV_B = { ...FAV_A, title: '影片 B' };

function seedCache(data: Record<string, unknown>) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      favorites: { data, timestamp: Date.now(), version: '1.0.0' },
    })
  );
}

function readCachedFavorites(): Record<string, unknown> {
  const raw = localStorage.getItem(CACHE_KEY);
  return raw ? JSON.parse(raw).favorites.data : {};
}

function loadModule() {
  return jest.requireActual<typeof import('./favorites')>('./favorites');
}

function setFetch(mock: jest.Mock) {
  (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = mock;
}

/** 可由測試決定何時完成的 promise，用來製造背景同步與寫入的交錯 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('收藏：靜默資料遺失路徑', () => {
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

  it('背景同步失敗不彈全域錯誤', async () => {
    seedCache({ 'a+1': FAV_A });
    const messages: string[] = [];
    window.addEventListener('globalError', (event) => {
      messages.push((event as CustomEvent<{ message: string }>).detail.message);
    });
    setFetch(jest.fn().mockRejectedValue(new Error('offline')));

    const { getAllFavorites } = loadModule();
    await expect(getAllFavorites()).resolves.toEqual({ 'a+1': FAV_A });
    await flush();

    expect(messages).toEqual([]);
  });

  it('背景同步的舊資料不得蓋掉同時間剛存下的收藏', async () => {
    seedCache({ 'a+1': FAV_A });

    // 背景同步回傳的是「還沒有新收藏」的伺服器狀態，由測試控制完成時機
    const sync = deferred<Record<string, unknown>>();
    setFetch(
      jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return { ok: true, status: 200 };
        return { ok: true, status: 200, json: () => sync.promise };
      })
    );

    const { getAllFavorites, saveFavorite } = loadModule();

    // 讀取 → 觸發背景同步（尚未完成）
    await getAllFavorites();

    // 同步還在路上時，使用者收藏了新影片
    await saveFavorite('b', '2', FAV_B as never);

    // 此時背景同步才拿到（不含 b+2 的）舊資料回來
    sync.resolve({ 'a+1': FAV_A });
    await flush();

    expect(Object.keys(readCachedFavorites()).sort()).toEqual(['a+1', 'b+2']);
  });

  it('寫入失敗時快取回滾，不留下假的收藏', async () => {
    seedCache({ 'a+1': FAV_A });
    setFetch(
      jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') throw new Error('network down');
        return { ok: true, status: 200, json: async () => ({ 'a+1': FAV_A }) };
      })
    );

    const { saveFavorite } = loadModule();

    await expect(saveFavorite('b', '2', FAV_B as never)).rejects.toThrow();
    await flush();

    expect(Object.keys(readCachedFavorites())).toEqual(['a+1']);
  });

  // 寫入失敗後走的是 handleDatabaseOperationFailure：它刻意重新向伺服器取權威
  // 狀態、而不是套用本地快照，所以這裡的 GET 要回傳「刪除沒成功」的伺服器內容。
  it('刪除失敗時被刪的收藏要回來', async () => {
    seedCache({ 'a+1': FAV_A, 'b+2': FAV_B });
    setFetch(
      jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') throw new Error('network down');
        return {
          ok: true,
          status: 200,
          json: async () => ({ 'a+1': FAV_A, 'b+2': FAV_B }),
        };
      })
    );

    const { deleteFavorite } = loadModule();

    await expect(deleteFavorite('b', '2')).rejects.toThrow();
    await flush();

    expect(Object.keys(readCachedFavorites()).sort()).toEqual(['a+1', 'b+2']);
  });

  it('刪除成功後不得殘留在快取（d4ef76f 的活引用回歸）', async () => {
    seedCache({ 'a+1': FAV_A, 'b+2': FAV_B });
    setFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      })
    );

    const { deleteFavorite } = loadModule();

    await deleteFavorite('b', '2');
    await flush();

    expect(Object.keys(readCachedFavorites())).toEqual(['a+1']);
  });
});
