/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { Redis } from '@upstash/redis';

import { AdminConfig } from './admin.types';
import type { BangumiAliasCacheEntry } from './bangumi-alias-storage';
import { hashPassword, isHashed, verifyPassword } from './password';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';
import { reconcileUserIndex } from './user-index';

// 搜索歷史最大條數
const SEARCH_HISTORY_LIMIT = 20;
const LOCK_RELEASE_RECEIPT_TTL_MS = 60_000;
const RENEW_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2])
  return 1
end
if redis.call('GET', KEYS[2]) == ARGV[1] then
  return 1
end
return 0
`;

// 數據類型轉換辅助函數
function ensureString(value: any): string {
  return String(value);
}

function ensureStringArray(value: any[]): string[] {
  return value.map((item) => String(item));
}

// 新增Upstash Redis操作重試包装器
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (err: any) {
      const isLastAttempt = i === maxRetries - 1;
      const isConnectionError =
        err.message?.includes('Connection') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ENOTFOUND') ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        err.name === 'UpstashError';

      if (isConnectionError && !isLastAttempt) {
        console.log(
          `Upstash Redis operation failed, retrying... (${i + 1}/${maxRetries})`
        );
        console.error('Error:', err.message);

        // 等待一段時間后重試
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }

      throw err;
    }
  }

  throw new Error('Max retries exceeded');
}

/**
 * 毀損資料的容錯讀取。
 *
 * @upstash/redis 反序列化失敗時「回傳原始字串」而不是拋錯——hgetall 的
 * deserialize 與其餘指令共用的 parseResponse 都是 catch 之後回傳原值。因此
 * 直接 `as T` 會讓一筆毀損欄位變成偽裝成物件的字串，靜默流進 API 回應、
 * 歷史頁與 cron 的集數更新（讀 .title / .total_episodes 全是 undefined）。
 *
 * BaseRedisStorage 對同一情境的處理是「跳過該欄位並警告」，並有回歸測試看守
 * （見 redis-base.db.test.ts：單一毀損欄位不得讓整個讀取失敗）。這裡複製那個
 * 「行為」，但不共用它的「實作」——parseHashEntries 吃的是 JSON 字串，而
 * Upstash 這側拿到的已經是反序列化後的值，形狀根本不同。硬要共用就得關掉
 * automaticDeserialization，那會改動這個檔案裡每一條讀取路徑。
 */
function asStoredRecord<T>(value: unknown, label: string): T | null {
  if (value === null || value === undefined) return null;
  // typeof null === 'object'，陣列也不該被當成合法紀錄，兩者都要排除
  if (typeof value !== 'object' || Array.isArray(value)) {
    console.warn(`略過毀損的資料: ${label}`);
    return null;
  }
  return value as T;
}

function collectStoredRecords<T>(
  all: Record<string, unknown> | null | undefined,
  hashKey: string
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [field, value] of Object.entries(all || {})) {
    if (value === null || value === undefined) continue;
    if (typeof value !== 'object' || Array.isArray(value)) {
      console.warn(`略過毀損的資料欄位: ${hashKey} / ${field}`);
      continue;
    }
    result[field] = value as T;
  }
  return result;
}

export class UpstashRedisStorage implements IStorage {
  private client: Redis;

  constructor() {
    this.client = getUpstashRedisClient();
  }

  async acquireLock(
    key: string,
    ownerToken: string,
    ttlMs: number
  ): Promise<boolean> {
    const result = await withRetry(() =>
      this.client.set(key, ownerToken, { nx: true, px: ttlMs })
    );
    if (result === 'OK') return true;

    // SET may have succeeded even if its response was lost before a retry.
    return (await withRetry(() => this.client.get<string>(key))) === ownerToken;
  }

  async renewLock(
    key: string,
    ownerToken: string,
    ttlMs: number
  ): Promise<boolean> {
    const result = await withRetry(() =>
      this.client.eval(RENEW_LOCK_SCRIPT, [key], [ownerToken, String(ttlMs)])
    );
    return Number(result) === 1;
  }

  async releaseLock(key: string, ownerToken: string): Promise<boolean> {
    const receiptKey = `${key}:released:${ownerToken}`;
    const result = await withRetry(() =>
      this.client.eval(
        RELEASE_LOCK_SCRIPT,
        [key, receiptKey],
        [ownerToken, String(LOCK_RELEASE_RECEIPT_TTL_MS)]
      )
    );
    return Number(result) === 1;
  }

  // ---------- 播放記錄 ----------
  private prHashKey(user: string) {
    return `u:${user}:pr`; // 一個使用者的所有播放記錄存在一個 Hash 中
  }

  async getPlayRecord(
    userName: string,
    key: string
  ): Promise<PlayRecord | null> {
    const val = await withRetry(() =>
      this.client.hget(this.prHashKey(userName), key)
    );
    return asStoredRecord<PlayRecord>(
      val,
      `${this.prHashKey(userName)} / ${key}`
    );
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await withRetry(() =>
      this.client.hset(this.prHashKey(userName), { [key]: record })
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const all = await withRetry(() =>
      this.client.hgetall(this.prHashKey(userName))
    );
    return collectStoredRecords<PlayRecord>(all, this.prHashKey(userName));
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.hdel(this.prHashKey(userName), key));
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    await withRetry(() => this.client.del(this.prHashKey(userName)));
  }

  // ---------- 收藏 ----------
  private favHashKey(user: string) {
    return `u:${user}:fav`; // 一個使用者的所有收藏存在一個 Hash 中
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await withRetry(() =>
      this.client.hget(this.favHashKey(userName), key)
    );
    return asStoredRecord<Favorite>(
      val,
      `${this.favHashKey(userName)} / ${key}`
    );
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await withRetry(() =>
      this.client.hset(this.favHashKey(userName), { [key]: favorite })
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const all = await withRetry(() =>
      this.client.hgetall(this.favHashKey(userName))
    );
    return collectStoredRecords<Favorite>(all, this.favHashKey(userName));
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await withRetry(() => this.client.hdel(this.favHashKey(userName), key));
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await withRetry(() => this.client.del(this.favHashKey(userName)));
  }

  // ---------- 使用者注冊 / 登錄 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const hashed = hashPassword(password);
    await withRetry(() => this.client.set(this.userPwdKey(userName), hashed));
    // 維護使用者集合
    await withRetry(() => this.client.sadd(this.usersSetKey(), userName));
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    const storedStr = ensureString(stored as any);
    const ok = verifyPassword(password, storedStr);
    // 平滑遷移：如果是明文密碼且驗證通過，自動升級为加盐哈希
    if (ok && !isHashed(storedStr)) {
      const hashed = hashPassword(password);
      await withRetry(() => this.client.set(this.userPwdKey(userName), hashed));
    }
    return ok;
  }

  // 檢查使用者是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判斷 key 是否存在
    const exists = await withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改使用者密碼
  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashed = hashPassword(newPassword);
    await withRetry(() => this.client.set(this.userPwdKey(userName), hashed));
  }

  // 刪除使用者及其所有數據
  async deleteUser(userName: string): Promise<void> {
    // 刪除使用者密碼
    await withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 從使用者集合中移除
    await withRetry(() => this.client.srem(this.usersSetKey(), userName));

    // 刪除搜索歷史
    await withRetry(() => this.client.del(this.shKey(userName)));

    // 刪除播放記錄（Hash key 直接刪除）
    await withRetry(() => this.client.del(this.prHashKey(userName)));

    // 刪除收藏夹（Hash key 直接刪除）
    await withRetry(() => this.client.del(this.favHashKey(userName)));

    // 刪除跳過片头片尾設定（Hash key 直接刪除）
    await withRetry(() => this.client.del(this.skipHashKey(userName)));
  }

  // ---------- 搜索歷史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await withRetry(() =>
      this.client.lrange(this.shKey(userName), 0, -1)
    );
    // 確保返回的都是字符串類型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    // 插入到最前
    await withRetry(() => this.client.lpush(key, ensureString(keyword)));
    // 限制最大長度
    await withRetry(() => this.client.ltrim(key, 0, SEARCH_HISTORY_LIMIT - 1));
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await withRetry(() => this.client.lrem(key, 0, ensureString(keyword)));
    } else {
      await withRetry(() => this.client.del(key));
    }
  }

  // ---------- 取得全部使用者 ----------
  private usersSetKey() {
    return 'sys:users';
  }

  async getAllUsers(): Promise<string[]> {
    // 與 redis-base 同步：密碼鍵為真相、索引自癒。Upstash 客戶端方法為小寫
    // （smembers/sadd），備份匯入的 sAdd 探測在此後端會靜默失敗，更需要自癒。
    const [members, pwdKeys] = await Promise.all([
      withRetry(() => this.client.smembers(this.usersSetKey())),
      withRetry(() => this.client.keys('u:*:pwd')),
    ]);
    const { users, missing } = reconcileUserIndex(
      ensureStringArray(members as any[]),
      ensureStringArray(pwdKeys as any[])
    );
    if (missing.length > 0) {
      // sadd 簽名要求至少一個固定成員引數，拆出首元素再展開其餘
      const [first, ...rest] = missing;
      await withRetry(() =>
        this.client.sadd(this.usersSetKey(), first, ...rest)
      );
    }
    return users;
  }

  // ---------- 管理员設定 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await withRetry(() => this.client.get(this.adminConfigKey()));
    return asStoredRecord<AdminConfig>(val, this.adminConfigKey());
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await withRetry(() => this.client.set(this.adminConfigKey(), config));
  }

  // ---------- 跳過片头片尾設定 ----------
  private skipHashKey(user: string) {
    return `u:${user}:skip`; // 一個使用者的所有跳過設定存在一個 Hash 中
  }

  private skipField(source: string, id: string) {
    return `${source}+${id}`;
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    const val = await withRetry(() =>
      this.client.hget(this.skipHashKey(userName), this.skipField(source, id))
    );
    return asStoredRecord<SkipConfig>(
      val,
      `${this.skipHashKey(userName)} / ${this.skipField(source, id)}`
    );
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await withRetry(() =>
      this.client.hset(this.skipHashKey(userName), {
        [this.skipField(source, id)]: config,
      })
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await withRetry(() =>
      this.client.hdel(this.skipHashKey(userName), this.skipField(source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const all = await withRetry(() =>
      this.client.hgetall(this.skipHashKey(userName))
    );
    return collectStoredRecords<SkipConfig>(all, this.skipHashKey(userName));
  }

  // ---------- 數據遷移：旧扁平 key → Hash 結构 ----------
  private migrationKey() {
    return 'sys:migration:hash_v2';
  }

  async migrateData(): Promise<void> {
    // 檢查是否已遷移
    const migrated = await withRetry(() =>
      this.client.get(this.migrationKey())
    );
    if (migrated === 'done') return;

    console.log('開始數據遷移：扁平 key → Hash 結构...');

    try {
      // 遷移播放記錄：u:*:pr:* → u:username:pr (Hash)
      const prKeys: string[] = await withRetry(() =>
        this.client.keys('u:*:pr:*')
      );
      if (prKeys.length > 0) {
        const oldPrKeys = prKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'pr' && parts[3] !== '';
        });

        for (const oldKey of oldPrKeys) {
          const match = oldKey.match(/^u:(.+?):pr:(.+)$/);
          if (!match) continue;
          const [, userName, field] = match;
          const value = await withRetry(() => this.client.get(oldKey));
          if (value) {
            await withRetry(() =>
              this.client.hset(this.prHashKey(userName), { [field]: value })
            );
            await withRetry(() => this.client.del(oldKey));
          }
        }
        if (oldPrKeys.length > 0) {
          console.log(`遷移了 ${oldPrKeys.length} 條播放記錄`);
        }
      }

      // 遷移收藏：u:*:fav:* → u:username:fav (Hash)
      const favKeys: string[] = await withRetry(() =>
        this.client.keys('u:*:fav:*')
      );
      if (favKeys.length > 0) {
        const oldFavKeys = favKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'fav' && parts[3] !== '';
        });

        for (const oldKey of oldFavKeys) {
          const match = oldKey.match(/^u:(.+?):fav:(.+)$/);
          if (!match) continue;
          const [, userName, field] = match;
          const value = await withRetry(() => this.client.get(oldKey));
          if (value) {
            await withRetry(() =>
              this.client.hset(this.favHashKey(userName), { [field]: value })
            );
            await withRetry(() => this.client.del(oldKey));
          }
        }
        if (oldFavKeys.length > 0) {
          console.log(`遷移了 ${oldFavKeys.length} 條收藏`);
        }
      }

      // 遷移 skipConfig：u:*:skip:* → u:username:skip (Hash)
      const skipKeys: string[] = await withRetry(() =>
        this.client.keys('u:*:skip:*')
      );
      if (skipKeys.length > 0) {
        const oldSkipKeys = skipKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'skip' && parts[3] !== '';
        });

        for (const oldKey of oldSkipKeys) {
          const match = oldKey.match(/^u:(.+?):skip:(.+)$/);
          if (!match) continue;
          const [, userName, field] = match;
          const value = await withRetry(() => this.client.get(oldKey));
          if (value) {
            await withRetry(() =>
              this.client.hset(this.skipHashKey(userName), { [field]: value })
            );
            await withRetry(() => this.client.del(oldKey));
          }
        }
        if (oldSkipKeys.length > 0) {
          console.log(`遷移了 ${oldSkipKeys.length} 條跳過設定`);
        }
      }

      // 遷移使用者列表：從 KEYS u:*:pwd 构建 sys:users Set
      const userSetExists = await withRetry(() =>
        this.client.exists(this.usersSetKey())
      );
      if (!userSetExists) {
        const pwdKeys: string[] = await withRetry(() =>
          this.client.keys('u:*:pwd')
        );
        const userNames = pwdKeys
          .map((k) => {
            const match = k.match(/^u:(.+?):pwd$/);
            return match ? match[1] : undefined;
          })
          .filter((u): u is string => typeof u === 'string');
        if (userNames.length > 0) {
          const [first, ...rest] = userNames;
          await withRetry(() =>
            this.client.sadd(this.usersSetKey(), first, ...rest)
          );
          console.log(`遷移了 ${userNames.length} 個使用者到 Set`);
        }
      }

      // 標記遷移完成
      await withRetry(() => this.client.set(this.migrationKey(), 'done'));
      console.log('數據遷移完成');
    } catch (error) {
      console.error('數據遷移失敗:', error);
      throw error;
    }
  }

  // ---------- 密碼遷移：明文 → 加盐哈希 ----------
  private pwdMigrationKey() {
    return 'sys:migration:pwd_hash_v1';
  }

  async migratePasswords(): Promise<void> {
    const migrated = await withRetry(() =>
      this.client.get(this.pwdMigrationKey())
    );
    if (migrated === 'done') return;

    console.log('開始密碼遷移：明文 → 加盐哈希...');

    try {
      const pwdKeys: string[] = await withRetry(() =>
        this.client.keys('u:*:pwd')
      );
      let count = 0;

      for (const key of pwdKeys) {
        const stored = await withRetry(() => this.client.get(key));
        if (stored === null) continue;
        const storedStr = ensureString(stored as any);
        // 跳過已經是哈希格式的
        if (isHashed(storedStr)) continue;
        // 将明文密碼轉为加盐哈希
        const hashed = hashPassword(storedStr);
        await withRetry(() => this.client.set(key, hashed));
        count++;
      }

      await withRetry(() => this.client.set(this.pwdMigrationKey(), 'done'));
      console.log(`密碼遷移完成，共遷移 ${count} 個使用者`);
    } catch (error) {
      console.error('密碼遷移失敗:', error);
    }
  }

  // 清空所有數據
  private bangumiAliasHashKey() {
    return 'sys:bangumi_aliases';
  }

  async getBangumiAliasCache(
    bangumiId: string
  ): Promise<BangumiAliasCacheEntry | null> {
    const value = await withRetry(() =>
      this.client.hget(this.bangumiAliasHashKey(), bangumiId)
    );
    return asStoredRecord<BangumiAliasCacheEntry>(
      value,
      `${this.bangumiAliasHashKey()} / ${bangumiId}`
    );
  }

  async setBangumiAliasCache(
    bangumiId: string,
    entry: BangumiAliasCacheEntry
  ): Promise<void> {
    await withRetry(() =>
      this.client.hset(this.bangumiAliasHashKey(), { [bangumiId]: entry })
    );
  }

  async clearAllData(): Promise<void> {
    try {
      // 取得所有使用者
      const allUsers = await this.getAllUsers();

      // 刪除所有使用者及其數據
      for (const username of allUsers) {
        await this.deleteUser(username);
      }

      // 刪除管理员設定
      await withRetry(() => this.client.del(this.adminConfigKey()));
      await withRetry(() => this.client.del(this.bangumiAliasHashKey()));

      console.log('所有數據已清空');
    } catch (error) {
      console.error('清空數據失敗:', error);
      throw new Error('清空數據失敗');
    }
  }
}

// 單例 Upstash Redis 客戶端
function getUpstashRedisClient(): Redis {
  const globalKey = Symbol.for('__MOONTV_UPSTASH_REDIS_CLIENT__');
  let client: Redis | undefined = (globalThis as { [key: symbol]: any })[
    globalKey
  ];

  if (!client) {
    const upstashUrl = process.env.UPSTASH_URL;
    const upstashToken = process.env.UPSTASH_TOKEN;

    if (!upstashUrl || !upstashToken) {
      throw new Error(
        'UPSTASH_URL and UPSTASH_TOKEN env variables must be set'
      );
    }

    // 創建 Upstash Redis 客戶端
    client = new Redis({
      url: upstashUrl,
      token: upstashToken,
      // 可選設定
      retry: {
        retries: 3,
        backoff: (retryCount: number) =>
          Math.min(1000 * Math.pow(2, retryCount), 30000),
      },
    });

    console.log('Upstash Redis client created successfully');

    (globalThis as { [key: symbol]: any })[globalKey] = client;
  }

  return client;
}
