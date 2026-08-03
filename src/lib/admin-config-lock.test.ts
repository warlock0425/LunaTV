/**
 * @jest-environment node
 *
 * 管理設定讀改寫鎖。
 *
 * 驗收標準（與 Opus 共識）：
 * 1. fake storage 必須真互斥——acquire 佔用中回 false，release 才放
 * 2. 斷言「並行寫入後兩邊改動都在」，不是「有呼叫到鎖」
 * 3. 第二條案例（無鎖）刻意證明交錯會 lost update；有鎖那條必須兩邊都在
 * 4. 鎖內必須重讀基底設定（測試模擬鎖外讀到的舊快照 vs 鎖內最新）
 */

import type { AdminConfig } from './admin.types';
import { DbManager } from './db';
import type { IStorage } from './types';

function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function baseConfig(): AdminConfig {
  return {
    ConfigFile: '{}',
    ConfigSubscription: { URL: '', AutoUpdate: false, LastCheck: '' },
    SiteConfig: {
      SiteName: 'Test',
      Announcement: '',
      SearchDownstreamMaxPage: 5,
      SiteInterfaceCacheTime: 7200,
      DoubanProxyType: 'direct',
      DoubanProxy: '',
      DoubanImageProxyType: 'direct',
      DoubanImageProxy: '',
      DisableYellowFilter: false,
      FluidSearch: true,
      EnableWebLive: false,
      PreferValidatedSourceOrder: false,
    },
    UserConfig: {
      Users: [{ username: 'alice', role: 'user' }],
    },
    SourceConfig: [
      {
        key: 'src1',
        name: '源1',
        api: 'https://a.test/api',
        from: 'custom',
      },
    ],
    CustomCategories: [],
    LiveConfig: [],
  };
}

/** 真互斥鎖 + 整份設定的記憶體後端 */
function createMutexAdminStorage(initial: AdminConfig) {
  let persisted = cloneConfig(initial);
  const locks = new Map<string, { token: string; expiresAt: number }>();

  const storage = {
    async getAdminConfig() {
      return cloneConfig(persisted);
    },
    async setAdminConfig(config: AdminConfig) {
      persisted = cloneConfig(config);
    },
    async acquireLock(key: string, ownerToken: string, ttlMs: number) {
      const current = locks.get(key);
      if (current && current.expiresAt > Date.now()) return false;
      locks.set(key, { token: ownerToken, expiresAt: Date.now() + ttlMs });
      return true;
    },
    async renewLock(key: string, ownerToken: string, ttlMs: number) {
      const current = locks.get(key);
      if (!current || current.token !== ownerToken) return false;
      current.expiresAt = Date.now() + ttlMs;
      return true;
    },
    async releaseLock(key: string, ownerToken: string) {
      const current = locks.get(key);
      if (!current || current.token !== ownerToken) return false;
      locks.delete(key);
      return true;
    },
  } as unknown as IStorage;

  return {
    storage,
    getPersisted: () => cloneConfig(persisted),
    setPersisted: (config: AdminConfig) => {
      persisted = cloneConfig(config);
    },
  };
}

describe('withAdminConfigLock：並行讀改寫不得 lost update', () => {
  it('並行改片源與改使用者時，兩邊改動都必須留在最終設定', async () => {
    const { storage, getPersisted } = createMutexAdminStorage(baseConfig());
    // 兩個 DbManager 實例：模擬不同行程／serverless 實例，不共用行程內佇列
    const dbA = new DbManager(storage);
    const dbB = new DbManager(storage);

    let releaseAAfterRead!: () => void;
    let aReadStarted!: () => void;
    const aReadStartedP = new Promise<void>((r) => {
      aReadStarted = r;
    });
    const aReadGate = new Promise<void>((r) => {
      releaseAAfterRead = r;
    });

    // A：讀到設定後暫停，模擬慢寫入；B 在 A 持鎖期間會等鎖，取得後應重讀到 A 的結果
    const taskA = dbA.withAdminConfigLock(async () => {
      const current = await storage.getAdminConfig!();
      aReadStarted();
      await aReadGate;
      const next = cloneConfig(current!);
      next.SourceConfig = [
        ...next.SourceConfig,
        {
          key: 'from-a',
          name: 'A加的源',
          api: 'https://a.example/api',
          from: 'custom',
        },
      ];
      await storage.setAdminConfig!(next);
    });

    await aReadStartedP;

    const taskB = dbB.withAdminConfigLock(async () => {
      // 關鍵：鎖內重讀，不能用鎖外的舊快照
      const current = await storage.getAdminConfig!();
      const next = cloneConfig(current!);
      next.UserConfig.Users = [
        ...next.UserConfig.Users,
        { username: 'bob', role: 'user' },
      ];
      await storage.setAdminConfig!(next);
    });

    releaseAAfterRead();
    await Promise.all([taskA, taskB]);

    const final = getPersisted();
    expect(final.SourceConfig.some((s) => s.key === 'from-a')).toBe(true);
    expect(final.UserConfig.Users.some((u) => u.username === 'bob')).toBe(true);
  });

  it('沒有鎖時並行寫入會 lost update（證明測試有交錯、不是裝飾）', async () => {
    const { storage, getPersisted } = createMutexAdminStorage(baseConfig());
    // 故意不用 withAdminConfigLock，直接並行「讀改寫」
    let releaseAAfterRead!: () => void;
    let aReadStarted!: () => void;
    const aReadStartedP = new Promise<void>((r) => {
      aReadStarted = r;
    });
    const aReadGate = new Promise<void>((r) => {
      releaseAAfterRead = r;
    });

    const taskA = (async () => {
      const current = await storage.getAdminConfig!();
      aReadStarted();
      await aReadGate;
      const next = cloneConfig(current!);
      next.SourceConfig = [
        ...next.SourceConfig,
        {
          key: 'from-a',
          name: 'A加的源',
          api: 'https://a.example/api',
          from: 'custom' as const,
        },
      ];
      await storage.setAdminConfig!(next);
    })();

    await aReadStartedP;

    const taskB = (async () => {
      // 與 A 交錯：B 在 A 寫入前就讀到舊快照
      const current = await storage.getAdminConfig!();
      const next = cloneConfig(current!);
      next.UserConfig.Users = [
        ...next.UserConfig.Users,
        { username: 'bob', role: 'user' as const },
      ];
      // 等 A 寫完再存，模擬「後寫覆蓋」
      await taskA;
      await storage.setAdminConfig!(next);
    })();

    releaseAAfterRead();
    await Promise.all([taskA, taskB]);

    const final = getPersisted();
    // 無鎖：B 以舊快照寫回，A 加的源會消失
    expect(final.SourceConfig.some((s) => s.key === 'from-a')).toBe(false);
    expect(final.UserConfig.Users.some((u) => u.username === 'bob')).toBe(true);
  });
});
