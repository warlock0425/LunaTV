/**
 * savePlayRecord 的「重抓整份播放紀錄」節流行為。
 *
 * 播放期間每 5 秒存一次進度，原本每次都會再 GET 一次完整清單（實測約 5.3KB）。
 * 這裡驗證節流後仍然保住關鍵行為：換集一定會以伺服器資料為準重新整理，
 * 這正是先前修「集數永不更新」時要守住的那條路徑。
 */

jest.mock('../auth', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'test-user' }),
}));

const CACHE_KEY = 'moontv_cache_test-user';

const BASE_RECORD = {
  title: '影片',
  source_name: '測試片源',
  year: '2026',
  cover: '',
  index: 1,
  total_episodes: 12,
  play_time: 10,
  total_time: 1200,
  save_time: 1,
};

function seedCache(record = BASE_RECORD) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      playRecords: {
        data: { 'source+1': record },
        timestamp: Date.now(),
        version: '1.0.0',
      },
    })
  );
}

/** 取得模組（每個測試都重新載入，避免節流狀態互相污染） */
function loadModule() {
  return jest.requireActual<typeof import('./play-records')>('./play-records');
}

function makeFetchMock() {
  // 第一次呼叫是 POST，其後可能是 GET
  return jest
    .fn()
    .mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, status: 200 };
      return {
        ok: true,
        status: 200,
        json: async () => ({ 'source+1': BASE_RECORD }),
      };
    });
}

function countGets(mock: jest.Mock) {
  return mock.mock.calls.filter(
    ([, init]) => !init || init.method === undefined || init.method === 'GET'
  ).length;
}

describe('savePlayRecord 重抓節流', () => {
  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    (
      window as typeof window & { RUNTIME_CONFIG?: { STORAGE_TYPE: string } }
    ).RUNTIME_CONFIG = { STORAGE_TYPE: 'kvrocks' };
    seedCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, 'fetch');
    Reflect.deleteProperty(
      window as typeof window & { RUNTIME_CONFIG?: unknown },
      'RUNTIME_CONFIG'
    );
  });

  it('換集時一定會重抓（集數同步的關鍵路徑）', async () => {
    const fetchMock = makeFetchMock();
    (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;

    const { savePlayRecord, __resetPlayRecordRefreshThrottle } = loadModule();
    __resetPlayRecordRefreshThrottle();

    // 先做一次進度心跳，把節流計時器啟動
    await savePlayRecord('source', '1', { ...BASE_RECORD, play_time: 20 });
    const getsAfterFirst = countGets(fetchMock);

    // 緊接著換集：即使還在節流視窗內，也必須重抓
    await savePlayRecord('source', '1', {
      ...BASE_RECORD,
      index: 2,
      play_time: 0,
    });

    expect(countGets(fetchMock)).toBeGreaterThan(getsAfterFirst);
  });

  it('總集數變動時也會重抓（追更抓到新集）', async () => {
    const fetchMock = makeFetchMock();
    (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;

    const { savePlayRecord, __resetPlayRecordRefreshThrottle } = loadModule();
    __resetPlayRecordRefreshThrottle();

    await savePlayRecord('source', '1', { ...BASE_RECORD, play_time: 20 });
    const before = countGets(fetchMock);

    await savePlayRecord('source', '1', {
      ...BASE_RECORD,
      total_episodes: 13,
      play_time: 30,
    });

    expect(countGets(fetchMock)).toBeGreaterThan(before);
  });

  it('連續的純進度心跳不會每次都重抓', async () => {
    const fetchMock = makeFetchMock();
    (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;

    const { savePlayRecord, __resetPlayRecordRefreshThrottle } = loadModule();
    __resetPlayRecordRefreshThrottle();

    for (let i = 1; i <= 6; i += 1) {
      await savePlayRecord('source', '1', {
        ...BASE_RECORD,
        play_time: 10 * i,
      });
    }

    // 6 次心跳只允許第一次重抓，其餘應被節流擋下
    expect(countGets(fetchMock)).toBe(1);
    // 但每一次都必須確實送出 POST（寫入不可被省略）
    const posts = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === 'POST'
    ).length;
    expect(posts).toBe(6);
  });

  it('超過節流間隔後會再次重抓（其他裝置的變更仍能同步）', async () => {
    const fetchMock = makeFetchMock();
    (globalThis as typeof globalThis & { fetch: jest.Mock }).fetch = fetchMock;

    const nowSpy = jest.spyOn(Date, 'now');
    let clock = 1_000_000;
    nowSpy.mockImplementation(() => clock);

    const { savePlayRecord, __resetPlayRecordRefreshThrottle } = loadModule();
    __resetPlayRecordRefreshThrottle();

    await savePlayRecord('source', '1', { ...BASE_RECORD, play_time: 20 });
    expect(countGets(fetchMock)).toBe(1);

    // 仍在節流視窗內
    clock += 30_000;
    await savePlayRecord('source', '1', { ...BASE_RECORD, play_time: 30 });
    expect(countGets(fetchMock)).toBe(1);

    // 超過 60 秒
    clock += 31_000;
    await savePlayRecord('source', '1', { ...BASE_RECORD, play_time: 40 });
    expect(countGets(fetchMock)).toBe(2);
  });
});
