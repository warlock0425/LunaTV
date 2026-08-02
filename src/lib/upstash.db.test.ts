/**
 * 毀損資料不得靜默流出。
 *
 * @upstash/redis 反序列化失敗時會回傳「原始字串」而不是拋錯（hgetall 的
 * deserialize 與其餘指令共用的 parseResponse 都是 catch 之後回傳原值）。
 * 舊版各處直接 `as PlayRecord` / `as Favorite`，於是一筆壞掉的欄位會變成
 * 偽裝成物件的字串流進 API 回應、歷史頁與 cron 的集數更新——讀 .title、
 * .total_episodes 全是 undefined，而且沒有任何錯誤訊息可循。
 *
 * BaseRedisStorage 早就有對應的容錯（見 redis-base.db.test.ts），但 Upstash 是
 * 另一份獨立實作、當時沒有同步，也沒有測試看守。這個檔案補上守門。
 */

const CLIENT_KEY = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');

type FakeClient = Record<string, jest.Mock>;

function installClient(client: FakeClient) {
  (globalThis as unknown as Record<symbol, unknown>)[CLIENT_KEY] = client;
}

async function createStorage(client: FakeClient) {
  installClient(client);
  const { UpstashRedisStorage } =
    jest.requireActual<typeof import('./upstash.db.js')>('./upstash.db');
  return new UpstashRedisStorage();
}

describe('UpstashRedisStorage 對毀損資料的容忍度', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<symbol, unknown>)[CLIENT_KEY];
    jest.restoreAllMocks();
    jest.resetModules();
  });

  // 反序列化失敗時 @upstash/redis 交回來的就是這種原始字串
  const CORRUPT = '{"title":"壞掉的紀錄"';

  describe('批次讀取：跳過壞欄位，其餘照常回傳', () => {
    it('getAllPlayRecords', async () => {
      const storage = await createStorage({
        hgetall: jest.fn().mockResolvedValue({
          good: { title: '正常', total_episodes: 12 },
          broken: CORRUPT,
        }),
      });

      const records = await storage.getAllPlayRecords('alice');

      expect(Object.keys(records)).toEqual(['good']);
      expect(records.good.title).toBe('正常');
    });

    it('getAllFavorites', async () => {
      const storage = await createStorage({
        hgetall: jest.fn().mockResolvedValue({
          good: { title: '正常' },
          broken: CORRUPT,
        }),
      });

      expect(Object.keys(await storage.getAllFavorites('alice'))).toEqual([
        'good',
      ]);
    });

    it('getAllSkipConfigs', async () => {
      const storage = await createStorage({
        hgetall: jest.fn().mockResolvedValue({
          good: { enable: true },
          broken: CORRUPT,
        }),
      });

      expect(Object.keys(await storage.getAllSkipConfigs('alice'))).toEqual([
        'good',
      ]);
    });

    it('整批都壞掉時回空物件而不是一堆字串', async () => {
      const storage = await createStorage({
        hgetall: jest
          .fn()
          .mockResolvedValue({ a: CORRUPT, b: CORRUPT, c: CORRUPT }),
      });

      expect(await storage.getAllPlayRecords('alice')).toEqual({});
    });

    it('hgetall 回 null 時不炸', async () => {
      const storage = await createStorage({
        hgetall: jest.fn().mockResolvedValue(null),
      });

      expect(await storage.getAllPlayRecords('alice')).toEqual({});
    });
  });

  describe('單筆讀取：毀損時回 null，不回字串', () => {
    it('getPlayRecord', async () => {
      const storage = await createStorage({
        hget: jest.fn().mockResolvedValue(CORRUPT),
      });

      await expect(storage.getPlayRecord('alice', 'k')).resolves.toBeNull();
    });

    it('getFavorite', async () => {
      const storage = await createStorage({
        hget: jest.fn().mockResolvedValue(CORRUPT),
      });

      await expect(storage.getFavorite('alice', 'k')).resolves.toBeNull();
    });

    it('getSkipConfig', async () => {
      const storage = await createStorage({
        hget: jest.fn().mockResolvedValue(CORRUPT),
      });

      await expect(
        storage.getSkipConfig('alice', 's', 'i')
      ).resolves.toBeNull();
    });

    it('getAdminConfig——站台設定壞掉時寧可回 null 也不要交出字串', async () => {
      const storage = await createStorage({
        get: jest.fn().mockResolvedValue(CORRUPT),
      });

      await expect(storage.getAdminConfig()).resolves.toBeNull();
    });

    it('getBangumiAliasCache', async () => {
      const storage = await createStorage({
        hget: jest.fn().mockResolvedValue(CORRUPT),
      });

      await expect(storage.getBangumiAliasCache('123')).resolves.toBeNull();
    });

    it('正常物件照常回傳', async () => {
      const storage = await createStorage({
        hget: jest.fn().mockResolvedValue({ title: '正常', index: 3 }),
      });

      await expect(storage.getPlayRecord('alice', 'k')).resolves.toEqual({
        title: '正常',
        index: 3,
      });
    });
  });

  describe('形狀判斷的邊界', () => {
    it('陣列不是合法紀錄（typeof [] === "object"，但不該通過）', async () => {
      const storage = await createStorage({
        hget: jest.fn().mockResolvedValue([1, 2, 3]),
        hgetall: jest.fn().mockResolvedValue({ arr: [1, 2, 3], ok: { a: 1 } }),
      });

      await expect(storage.getPlayRecord('alice', 'k')).resolves.toBeNull();
      expect(Object.keys(await storage.getAllPlayRecords('alice'))).toEqual([
        'ok',
      ]);
    });

    it('數字與布林同樣被擋下', async () => {
      const storage = await createStorage({
        hgetall: jest.fn().mockResolvedValue({ n: 42, b: true, ok: { a: 1 } }),
      });

      expect(Object.keys(await storage.getAllPlayRecords('alice'))).toEqual([
        'ok',
      ]);
    });

    it('欄位為 null 時安靜跳過，不視為毀損', async () => {
      const storage = await createStorage({
        hgetall: jest.fn().mockResolvedValue({ empty: null, ok: { a: 1 } }),
      });

      expect(Object.keys(await storage.getAllPlayRecords('alice'))).toEqual([
        'ok',
      ]);
      expect(console.warn).not.toHaveBeenCalled();
    });
  });
});
