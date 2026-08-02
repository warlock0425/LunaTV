/**
 * 片頭片尾略過設定的靜默資料遺失路徑。
 *
 * 與 favorites 同構：d4ef76f 修過這支的 delete 路徑（就地刪改快取活引用），
 * 但 set 路徑一直沿用同樣的寫法，且始終沒有測試。這裡鎖住的是「使用者調好的
 * 略過秒數不會無聲被還原」。
 */

jest.mock('../auth', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'test-user' }),
}));

const CACHE_KEY = 'moontv_cache_test-user';

const CONFIG_A = { enable: true, intro_time: 90, outro_time: 60 };
const CONFIG_B = { enable: true, intro_time: 30, outro_time: 20 };

function seedCache(data: Record<string, unknown>) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      skipConfigs: { data, timestamp: Date.now(), version: '1.0.0' },
    })
  );
}

function readCached(): Record<string, unknown> {
  const raw = localStorage.getItem(CACHE_KEY);
  return raw ? JSON.parse(raw).skipConfigs.data : {};
}

function loadModule() {
  return jest.requireActual<typeof import('./skip-configs')>('./skip-configs');
}

function setFetch(mock: jest.Mock) {
  (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = mock;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('略過設定：靜默資料遺失路徑', () => {
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

  it('背景同步的舊資料不得蓋掉同時間剛存下的設定', async () => {
    seedCache({ 'a+1': CONFIG_A });

    const sync = deferred<Record<string, unknown>>();
    setFetch(
      jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') return { ok: true, status: 200 };
        return { ok: true, status: 200, json: () => sync.promise };
      })
    );

    const { getAllSkipConfigs, saveSkipConfig } = loadModule();

    await getAllSkipConfigs();
    await saveSkipConfig('b', '2', CONFIG_B as never);

    sync.resolve({ 'a+1': CONFIG_A });
    await flush();

    expect(Object.keys(readCached()).sort()).toEqual(['a+1', 'b+2']);
  });

  it('寫入失敗時以伺服器權威狀態為準，不留下假的設定', async () => {
    seedCache({ 'a+1': CONFIG_A });
    setFetch(
      jest.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') throw new Error('network down');
        return {
          ok: true,
          status: 200,
          json: async () => ({ 'a+1': CONFIG_A }),
        };
      })
    );

    const { saveSkipConfig } = loadModule();

    await expect(saveSkipConfig('b', '2', CONFIG_B as never)).rejects.toThrow();
    await flush();

    expect(Object.keys(readCached())).toEqual(['a+1']);
  });

  it('刪除成功後不得殘留在快取（d4ef76f 的活引用回歸）', async () => {
    seedCache({ 'a+1': CONFIG_A, 'b+2': CONFIG_B });
    setFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      })
    );

    const { deleteSkipConfig } = loadModule();

    await deleteSkipConfig('b', '2');
    await flush();

    expect(Object.keys(readCached())).toEqual(['a+1']);
  });
});
