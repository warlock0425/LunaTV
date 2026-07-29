/**
 * 單一毀損欄位不得讓整個讀取失敗。
 *
 * Redis Hash 裡只要有一筆 JSON 壞掉（連線截斷、手動改壞），舊版的
 * `JSON.parse(raw)` 會直接往外拋，讓 /api/playrecords 永久 500——使用者的
 * 歷史頁整個掛掉，而且自己救不回來，cron 的集數更新也會跳過該使用者。
 */
describe('BaseRedisStorage 對毀損資料的容忍度', () => {
  afterEach(() => {
    jest.dontMock('redis');
    jest.restoreAllMocks();
    jest.resetModules();
  });

  async function createStorage(client: Record<string, unknown>) {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.doMock('redis', () => ({ createClient: jest.fn(() => client) }));

    const { BaseRedisStorage } =
      jest.requireActual<typeof import('./redis-base.db.js')>(
        './redis-base.db'
      );
    class TestRedisStorage extends BaseRedisStorage {
      constructor() {
        super(
          { url: 'redis://example.test:6379', clientName: 'TestRedis' },
          Symbol('test-redis-corrupt')
        );
      }
    }
    return new TestRedisStorage();
  }

  const baseClient = () => ({
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
  });

  it('getAllPlayRecords 跳過壞掉的欄位並回傳其餘紀錄', async () => {
    const storage = await createStorage({
      ...baseClient(),
      hGetAll: jest.fn().mockResolvedValue({
        'src+good': JSON.stringify({ title: '好的紀錄', index: 1 }),
        'src+truncated': '{"title":"被截斷的',
        'src+garbage': 'not json at all',
        'src+empty': '',
        'src+alsoGood': JSON.stringify({ title: '另一筆', index: 2 }),
      }),
    });

    const records = await storage.getAllPlayRecords('alice');

    expect(Object.keys(records).sort()).toEqual(['src+alsoGood', 'src+good']);
    expect(records['src+good']).toMatchObject({ title: '好的紀錄' });
  });

  it('getAllFavorites / getAllSkipConfigs 同樣不會整批失敗', async () => {
    const storage = await createStorage({
      ...baseClient(),
      hGetAll: jest
        .fn()
        .mockResolvedValue({ ok: '{"title":"x"}', broken: '{' }),
    });

    await expect(storage.getAllFavorites('alice')).resolves.toEqual({
      ok: { title: 'x' },
    });
    await expect(storage.getAllSkipConfigs('alice')).resolves.toEqual({
      ok: { title: 'x' },
    });
  });

  it('單筆讀取遇到毀損資料時回傳 null 而非拋錯', async () => {
    const storage = await createStorage({
      ...baseClient(),
      hGet: jest.fn().mockResolvedValue('{"unterminated'),
      get: jest.fn().mockResolvedValue('}{'),
    });

    await expect(storage.getPlayRecord('alice', 'src+1')).resolves.toBeNull();
    await expect(storage.getFavorite('alice', 'src+1')).resolves.toBeNull();
    await expect(
      storage.getSkipConfig('alice', 'src', '1')
    ).resolves.toBeNull();
    await expect(storage.getAdminConfig()).resolves.toBeNull();
  });
});

/**
 * getAllUsers 每次讀取都會呼叫（cron 每輪、管理後台、備份匯出匯入）。
 * 原本用 KEYS 掃描全鍵，會阻塞 Redis 主執行緒；改為 SCAN 分批。
 */
describe('BaseRedisStorage 的使用者名冊掃描', () => {
  afterEach(() => {
    jest.dontMock('redis');
    jest.restoreAllMocks();
    jest.resetModules();
  });

  async function createStorage(client: Record<string, unknown>) {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.doMock('redis', () => ({ createClient: jest.fn(() => client) }));
    const { BaseRedisStorage } =
      jest.requireActual<typeof import('./redis-base.db.js')>(
        './redis-base.db'
      );
    class TestRedisStorage extends BaseRedisStorage {
      constructor() {
        super(
          { url: 'redis://example.test:6379', clientName: 'TestRedis' },
          Symbol('test-redis-scan')
        );
      }
    }
    return new TestRedisStorage();
  }

  it('用 SCAN 逐批取完所有密碼鍵，且不呼叫 KEYS', async () => {
    const scan = jest
      .fn()
      .mockResolvedValueOnce({ cursor: '17', keys: ['u:alice:pwd'] })
      .mockResolvedValueOnce({ cursor: '42', keys: ['u:bob:pwd'] })
      .mockResolvedValueOnce({ cursor: '0', keys: ['u:carol:pwd'] });
    const keys = jest.fn();
    const storage = await createStorage({
      connect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      sMembers: jest.fn().mockResolvedValue(['alice']),
      sAdd: jest.fn().mockResolvedValue(2),
      scan,
      keys,
    });

    const users = await storage.getAllUsers();

    expect(keys).not.toHaveBeenCalled();
    expect(scan).toHaveBeenCalledTimes(3);
    expect(users.sort()).toEqual(['alice', 'bob', 'carol']);
  });

  it('索引缺漏的帳號會補寫回 sys:users', async () => {
    const sAdd = jest.fn().mockResolvedValue(1);
    const storage = await createStorage({
      connect: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
      sMembers: jest.fn().mockResolvedValue([]),
      sAdd,
      scan: jest.fn().mockResolvedValue({ cursor: '0', keys: ['u:dave:pwd'] }),
    });

    await storage.getAllUsers();

    expect(sAdd).toHaveBeenCalledWith('sys:users', ['dave']);
  });
});
