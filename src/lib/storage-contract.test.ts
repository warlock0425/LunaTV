/**
 * 儲存後端的行為合約——防止兩份獨立實作再次漂移。
 *
 * IStorage 有兩份互不相干的實作：BaseRedisStorage（Docker 預設的 kvrocks／
 * redis 走這條）與 UpstashRedisStorage（Vercel 路線），各自 34 個方法。
 * TypeScript 只保證兩邊的「簽章」一致，不保證「行為」一致——而行為已經分叉過：
 *
 *   redis-base 在一次事故後補上了「單一毀損欄位不得讓整個讀取失敗」的容錯
 *   （見 redis-base.db.test.ts），upstash 那側沒有同步，直到 77aa110 才補。
 *   期間 Upstash 使用者拿到的是「偽裝成紀錄的字串」，HTTP 200、無警告。
 *
 * 那次是靠人工比對兩個檔案才發現的。這個檔案把「必須兩邊一致」的行為寫成同一
 * 份案例、分別跑過兩個實作：任一邊掉了防護就紅燈，不必再靠人記得同步。
 *
 * 這裡只放「兩邊都必須成立」的不變式。各後端專屬的邊界（upstash 的陣列／數字
 * 判定、redis 的空字串處理）留在各自的測試檔，不要搬進來——那會讓合約變成
 * 兩份實作細節的聯集，反而綁死重構。
 *
 * 新增第三個後端時，把它加進下面的 BACKENDS 就會自動套用同一份合約。
 */

import type { IStorage } from './types';

/** 一個後端的接線方式：怎麼造 storage、資料在它的 client 交出來時長什麼樣 */
interface Backend {
  name: string;
  /** 正常紀錄在該後端 client 回傳時的形狀 */
  encode: (value: Record<string, unknown>) => unknown;
  /** 反序列化失敗時該後端 client 交出來的東西 */
  corrupt: unknown;
  createStorage: (responses: {
    hash?: Record<string, unknown>;
    single?: unknown;
  }) => Promise<IStorage>;
}

const UPSTASH_CLIENT_KEY = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');

const BACKENDS: Backend[] = [
  {
    name: 'BaseRedisStorage',
    // node-redis 交回來的是原始 JSON 字串，由我方 JSON.parse
    encode: (value) => JSON.stringify(value),
    corrupt: '{"title":"被截斷的',
    createStorage: async ({ hash, single }) => {
      jest.doMock('redis', () => ({
        createClient: jest.fn(() => ({
          connect: jest.fn().mockResolvedValue(undefined),
          on: jest.fn(),
          hGetAll: jest.fn().mockResolvedValue(hash ?? {}),
          hGet: jest.fn().mockResolvedValue(single ?? null),
          get: jest.fn().mockResolvedValue(single ?? null),
        })),
      }));

      const { BaseRedisStorage } =
        jest.requireActual<typeof import('./redis-base.db.js')>(
          './redis-base.db'
        );
      class TestRedisStorage extends BaseRedisStorage {
        constructor() {
          super(
            { url: 'redis://example.test:6379', clientName: 'TestRedis' },
            Symbol('storage-contract')
          );
        }
      }
      return new TestRedisStorage() as unknown as IStorage;
    },
  },
  {
    name: 'UpstashRedisStorage',
    // @upstash/redis 會自動反序列化，交回來的已經是物件
    encode: (value) => value,
    // 反序列化失敗時它不拋錯，而是原樣交回字串（見 77aa110）
    corrupt: '{"title":"被截斷的',
    createStorage: async ({ hash, single }) => {
      (globalThis as unknown as Record<symbol, unknown>)[UPSTASH_CLIENT_KEY] = {
        hgetall: jest.fn().mockResolvedValue(hash ?? {}),
        hget: jest.fn().mockResolvedValue(single ?? null),
        get: jest.fn().mockResolvedValue(single ?? null),
      };

      const { UpstashRedisStorage } =
        jest.requireActual<typeof import('./upstash.db.js')>('./upstash.db');
      return new UpstashRedisStorage() as unknown as IStorage;
    },
  },
];

describe.each(BACKENDS)('$name 的儲存行為合約', (backend) => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.dontMock('redis');
    delete (globalThis as unknown as Record<symbol, unknown>)[
      UPSTASH_CLIENT_KEY
    ];
    jest.restoreAllMocks();
    jest.resetModules();
  });

  const GOOD = { title: '正常紀錄', index: 1 };
  const ALSO_GOOD = { title: '另一筆', index: 2 };

  /** 一份「好壞混雜」的 hash，好資料必須全數存活 */
  const mixedHash = () => ({
    good: backend.encode(GOOD),
    broken: backend.corrupt,
    alsoGood: backend.encode(ALSO_GOOD),
  });

  describe('批次讀取：毀損欄位不得拖垮整批', () => {
    it.each([
      ['getAllPlayRecords', (s: IStorage) => s.getAllPlayRecords('alice')],
      ['getAllFavorites', (s: IStorage) => s.getAllFavorites('alice')],
      ['getAllSkipConfigs', (s: IStorage) => s.getAllSkipConfigs('alice')],
    ])('%s', async (_name, read) => {
      const storage = await backend.createStorage({ hash: mixedHash() });

      const result = (await read(storage)) as Record<string, unknown>;

      expect(Object.keys(result).sort()).toEqual(['alsoGood', 'good']);
      expect(result.good).toMatchObject({ title: '正常紀錄' });
    });

    it('整批都毀損時回空物件，不是一堆垃圾', async () => {
      const storage = await backend.createStorage({
        hash: { a: backend.corrupt, b: backend.corrupt },
      });

      await expect(storage.getAllPlayRecords('alice')).resolves.toEqual({});
    });

    it('空的 hash 不會拋錯', async () => {
      const storage = await backend.createStorage({ hash: {} });

      await expect(storage.getAllPlayRecords('alice')).resolves.toEqual({});
    });
  });

  describe('單筆讀取：毀損時回 null，不得交出半成品', () => {
    it.each([
      ['getPlayRecord', (s: IStorage) => s.getPlayRecord('alice', 'src+1')],
      ['getFavorite', (s: IStorage) => s.getFavorite('alice', 'src+1')],
      ['getSkipConfig', (s: IStorage) => s.getSkipConfig('alice', 'src', '1')],
      ['getAdminConfig', (s: IStorage) => s.getAdminConfig()],
    ])('%s', async (_name, read) => {
      const storage = await backend.createStorage({ single: backend.corrupt });

      await expect(read(storage)).resolves.toBeNull();
    });

    it('正常資料照常回傳', async () => {
      const storage = await backend.createStorage({
        single: backend.encode(GOOD),
      });

      await expect(
        storage.getPlayRecord('alice', 'src+1')
      ).resolves.toMatchObject({ title: '正常紀錄' });
    });
  });
});
