/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { createClient, RedisClientType } from 'redis';

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

/**
 * 解析 Hash 欄位。單一欄位毀損（連線截斷、手動改壞）不該讓整個
 * hGetAll 拋錯——那會讓該使用者的播放紀錄／收藏永久 500，而且使用者
 * 自己救不回來。壞掉的欄位記錄後跳過即可。
 */
function parseHashEntries<T>(
  all: Record<string, string | null | undefined>,
  hashKey: string
): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [field, raw] of Object.entries(all)) {
    if (!raw) continue;
    try {
      result[field] = JSON.parse(raw) as T;
    } catch {
      console.warn(`略過毀損的資料欄位: ${hashKey} / ${field}`);
    }
  }
  return result;
}

function parseJsonValue<T>(
  raw: string | null | undefined,
  label: string
): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(`略過毀損的資料: ${label}`);
    return null;
  }
}

// 連接設定接口
export interface RedisConnectionConfig {
  url: string;
  clientName: string; // 用於日志顯示，如 "Redis" 或 "Pika"
}

// 新增Redis操作重試包装器
function createRetryWrapper(
  clientName: string,
  getClient: () => RedisClientType
) {
  return async function withRetry<T>(
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
          err.code === 'EPIPE';

        if (isConnectionError && !isLastAttempt) {
          console.log(
            `${clientName} operation failed, retrying... (${
              i + 1
            }/${maxRetries})`
          );
          console.error('Error:', err.message);

          // 等待一段時間后重試
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));

          // 嘗試重新連接
          try {
            const client = getClient();
            if (!client.isOpen) {
              await client.connect();
            }
          } catch (reconnectErr) {
            console.error('Failed to reconnect:', reconnectErr);
          }

          continue;
        }

        throw err;
      }
    }

    throw new Error('Max retries exceeded');
  };
}

// 創建客戶端的工厂函數
export function createRedisClient(
  config: RedisConnectionConfig,
  globalSymbol: symbol
): RedisClientType {
  let client: RedisClientType | undefined = (
    globalThis as { [key: symbol]: any }
  )[globalSymbol];

  if (!client) {
    if (!config.url) {
      throw new Error(`${config.clientName}_URL env variable not set`);
    }

    // 創建客戶端設定
    const clientConfig: any = {
      url: config.url,
      socket: {
        // 重連策略：指數退避，最大30秒
        reconnectStrategy: (retries: number) => {
          console.log(
            `${config.clientName} reconnection attempt ${retries + 1}`
          );
          if (retries > 10) {
            console.error(
              `${config.clientName} max reconnection attempts exceeded`
            );
            return false; // 停止重連
          }
          return Math.min(1000 * Math.pow(2, retries), 30000); // 指數退避，最大30秒
        },
        connectTimeout: 10000, // 10秒連接超時
        // 設置no delay，减少延迟
        noDelay: true,
      },
      // 新增其他設定
      pingInterval: 30000, // 30秒ping一次，保持連接活跃
    };

    client = createClient(clientConfig);

    // 新增錯誤事件監听
    client.on('error', (err) => {
      console.error(`${config.clientName} client error:`, err);
    });

    client.on('connect', () => {
      console.log(`${config.clientName} connected`);
    });

    client.on('reconnecting', () => {
      console.log(`${config.clientName} reconnecting...`);
    });

    client.on('ready', () => {
      console.log(`${config.clientName} ready`);
    });

    // 初始連接，带重試機制
    const connectWithRetry = async () => {
      try {
        await client!.connect();
        console.log(`${config.clientName} connected successfully`);
      } catch (err) {
        console.error(`${config.clientName} initial connection failed:`, err);
        console.log('Will retry in 5 seconds...');
        setTimeout(connectWithRetry, 5000);
      }
    };

    connectWithRetry();

    (globalThis as { [key: symbol]: any })[globalSymbol] = client;
  }

  return client;
}

// 抽象基類，包含所有通用的Redis操作逻辑
export abstract class BaseRedisStorage implements IStorage {
  protected client: RedisClientType;
  protected withRetry: <T>(
    operation: () => Promise<T>,
    maxRetries?: number
  ) => Promise<T>;

  constructor(config: RedisConnectionConfig, globalSymbol: symbol) {
    this.client = createRedisClient(config, globalSymbol);
    this.withRetry = createRetryWrapper(config.clientName, () => this.client);
  }

  async acquireLock(
    key: string,
    ownerToken: string,
    ttlMs: number
  ): Promise<boolean> {
    const result = await this.withRetry(() =>
      this.client.set(key, ownerToken, { NX: true, PX: ttlMs })
    );
    if (result === 'OK') return true;

    // SET may have succeeded even if its response was lost before a retry.
    return (await this.withRetry(() => this.client.get(key))) === ownerToken;
  }

  async renewLock(
    key: string,
    ownerToken: string,
    ttlMs: number
  ): Promise<boolean> {
    const result = await this.withRetry(() =>
      this.client.eval(RENEW_LOCK_SCRIPT, {
        keys: [key],
        arguments: [ownerToken, String(ttlMs)],
      })
    );
    return Number(result) === 1;
  }

  async releaseLock(key: string, ownerToken: string): Promise<boolean> {
    const receiptKey = `${key}:released:${ownerToken}`;
    const result = await this.withRetry(() =>
      this.client.eval(RELEASE_LOCK_SCRIPT, {
        keys: [key, receiptKey],
        arguments: [ownerToken, String(LOCK_RELEASE_RECEIPT_TTL_MS)],
      })
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
    const val = await this.withRetry(() =>
      this.client.hGet(this.prHashKey(userName), key)
    );
    return parseJsonValue<PlayRecord>(
      val,
      `${this.prHashKey(userName)}/${key}`
    );
  }

  async setPlayRecord(
    userName: string,
    key: string,
    record: PlayRecord
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hSet(this.prHashKey(userName), key, JSON.stringify(record))
    );
  }

  async getAllPlayRecords(
    userName: string
  ): Promise<Record<string, PlayRecord>> {
    const all = await this.withRetry(() =>
      this.client.hGetAll(this.prHashKey(userName))
    );
    return parseHashEntries<PlayRecord>(all, this.prHashKey(userName));
  }

  async deletePlayRecord(userName: string, key: string): Promise<void> {
    await this.withRetry(() => this.client.hDel(this.prHashKey(userName), key));
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    await this.withRetry(() => this.client.del(this.prHashKey(userName)));
  }

  // ---------- 收藏 ----------
  private favHashKey(user: string) {
    return `u:${user}:fav`; // 一個使用者的所有收藏存在一個 Hash 中
  }

  async getFavorite(userName: string, key: string): Promise<Favorite | null> {
    const val = await this.withRetry(() =>
      this.client.hGet(this.favHashKey(userName), key)
    );
    return parseJsonValue<Favorite>(val, `${this.favHashKey(userName)}/${key}`);
  }

  async setFavorite(
    userName: string,
    key: string,
    favorite: Favorite
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hSet(this.favHashKey(userName), key, JSON.stringify(favorite))
    );
  }

  async getAllFavorites(userName: string): Promise<Record<string, Favorite>> {
    const all = await this.withRetry(() =>
      this.client.hGetAll(this.favHashKey(userName))
    );
    return parseHashEntries<Favorite>(all, this.favHashKey(userName));
  }

  async deleteFavorite(userName: string, key: string): Promise<void> {
    await this.withRetry(() =>
      this.client.hDel(this.favHashKey(userName), key)
    );
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await this.withRetry(() => this.client.del(this.favHashKey(userName)));
  }

  // ---------- 使用者注冊 / 登錄 ----------
  private userPwdKey(user: string) {
    return `u:${user}:pwd`;
  }

  async registerUser(userName: string, password: string): Promise<void> {
    const hashed = hashPassword(password);
    await this.withRetry(() =>
      this.client.set(this.userPwdKey(userName), hashed)
    );
    // 維護使用者集合
    await this.withRetry(() => this.client.sAdd(this.usersSetKey(), userName));
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    const stored = await this.withRetry(() =>
      this.client.get(this.userPwdKey(userName))
    );
    if (stored === null) return false;
    const storedStr = ensureString(stored);
    const ok = verifyPassword(password, storedStr);
    // 平滑遷移：如果是明文密碼且驗證通過，自動升級为加盐哈希
    if (ok && !isHashed(storedStr)) {
      const hashed = hashPassword(password);
      await this.withRetry(() =>
        this.client.set(this.userPwdKey(userName), hashed)
      );
    }
    return ok;
  }

  // 檢查使用者是否存在
  async checkUserExist(userName: string): Promise<boolean> {
    // 使用 EXISTS 判斷 key 是否存在
    const exists = await this.withRetry(() =>
      this.client.exists(this.userPwdKey(userName))
    );
    return exists === 1;
  }

  // 修改使用者密碼
  async changePassword(userName: string, newPassword: string): Promise<void> {
    const hashed = hashPassword(newPassword);
    await this.withRetry(() =>
      this.client.set(this.userPwdKey(userName), hashed)
    );
  }

  // 刪除使用者及其所有數據
  async deleteUser(userName: string): Promise<void> {
    // 刪除使用者密碼
    await this.withRetry(() => this.client.del(this.userPwdKey(userName)));

    // 從使用者集合中移除
    await this.withRetry(() => this.client.sRem(this.usersSetKey(), userName));

    // 刪除搜索歷史
    await this.withRetry(() => this.client.del(this.shKey(userName)));

    // 刪除播放記錄（Hash key 直接刪除）
    await this.withRetry(() => this.client.del(this.prHashKey(userName)));

    // 刪除收藏夹（Hash key 直接刪除）
    await this.withRetry(() => this.client.del(this.favHashKey(userName)));

    // 刪除跳過片头片尾設定（Hash key 直接刪除）
    await this.withRetry(() => this.client.del(this.skipHashKey(userName)));
  }

  // ---------- 搜索歷史 ----------
  private shKey(user: string) {
    return `u:${user}:sh`; // u:username:sh
  }

  async getSearchHistory(userName: string): Promise<string[]> {
    const result = await this.withRetry(() =>
      this.client.lRange(this.shKey(userName), 0, -1)
    );
    // 確保返回的都是字符串類型
    return ensureStringArray(result as any[]);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    const key = this.shKey(userName);
    // 先去重
    await this.withRetry(() => this.client.lRem(key, 0, ensureString(keyword)));
    // 插入到最前
    await this.withRetry(() => this.client.lPush(key, ensureString(keyword)));
    // 限制最大長度
    await this.withRetry(() =>
      this.client.lTrim(key, 0, SEARCH_HISTORY_LIMIT - 1)
    );
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    const key = this.shKey(userName);
    if (keyword) {
      await this.withRetry(() =>
        this.client.lRem(key, 0, ensureString(keyword))
      );
    } else {
      await this.withRetry(() => this.client.del(key));
    }
  }

  // ---------- 取得全部使用者 ----------
  private usersSetKey() {
    return 'sys:users';
  }

  async getAllUsers(): Promise<string[]> {
    // 對齊上游語意：密碼鍵（u:*:pwd）是名冊的最終真相，sys:users 只是快取。
    // 索引有多條漏登記路徑（一次性遷移旗標鎖死、備份匯入繞過 sAdd 等），
    // 漏掉的帳號能登入但會被 cron 集數更新永遠略過，故讀取時比對自癒。
    //
    // 這裡刻意保留 KEYS 而不改用 SCAN。KEYS 確實會阻塞主執行緒，但本專案的
    // 鍵空間規模是「使用者數 × 個位數個鍵」，實際耗時微不足道；而後端可能是
    // Kvrocks，其 SCAN 的游標語意與 MATCH 行為和 Redis 並不完全一致，一旦
    // 少掃到密碼鍵就會讓帳號從名冊消失——症狀正是「該帳號的集數永遠不更新」，
    // 而且完全沒有錯誤訊息。除非鍵空間真的長到會拖慢，否則不值得換。
    const [members, pwdKeys] = await Promise.all([
      this.withRetry(() => this.client.sMembers(this.usersSetKey())),
      this.withRetry(() => this.client.keys('u:*:pwd')),
    ]);
    const { users, missing } = reconcileUserIndex(
      ensureStringArray(members as any[]),
      ensureStringArray(pwdKeys as any[])
    );
    if (missing.length > 0) {
      await this.withRetry(() => this.client.sAdd(this.usersSetKey(), missing));
    }
    return users;
  }

  // ---------- 管理员設定 ----------
  private adminConfigKey() {
    return 'admin:config';
  }

  async getAdminConfig(): Promise<AdminConfig | null> {
    const val = await this.withRetry(() =>
      this.client.get(this.adminConfigKey())
    );
    return parseJsonValue<AdminConfig>(val, this.adminConfigKey());
  }

  async setAdminConfig(config: AdminConfig): Promise<void> {
    await this.withRetry(() =>
      this.client.set(this.adminConfigKey(), JSON.stringify(config))
    );
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
    const val = await this.withRetry(() =>
      this.client.hGet(this.skipHashKey(userName), this.skipField(source, id))
    );
    return parseJsonValue<SkipConfig>(
      val,
      `${this.skipHashKey(userName)}/${this.skipField(source, id)}`
    );
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hSet(
        this.skipHashKey(userName),
        this.skipField(source, id),
        JSON.stringify(config)
      )
    );
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hDel(this.skipHashKey(userName), this.skipField(source, id))
    );
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    const all = await this.withRetry(() =>
      this.client.hGetAll(this.skipHashKey(userName))
    );
    return parseHashEntries<SkipConfig>(all, this.skipHashKey(userName));
  }

  // ---------- 數據遷移：旧扁平 key → Hash 結构 ----------
  private migrationKey() {
    return 'sys:migration:hash_v2';
  }

  async migrateData(): Promise<void> {
    // 檢查是否已遷移
    const migrated = await this.withRetry(() =>
      this.client.get(this.migrationKey())
    );
    if (migrated === 'done') return;

    console.log('開始數據遷移：扁平 key → Hash 結构...');

    try {
      // 遷移播放記錄：u:*:pr:* → u:username:pr (Hash)
      const prKeys = await this.withRetry(() => this.client.keys('u:*:pr:*'));
      if (prKeys.length > 0) {
        const oldPrKeys = prKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'pr' && parts[3] !== '';
        });

        if (oldPrKeys.length > 0) {
          const values = await this.withRetry(() =>
            this.client.mGet(oldPrKeys)
          );
          for (let i = 0; i < oldPrKeys.length; i++) {
            const raw = values[i];
            if (!raw) continue;
            const match = oldPrKeys[i].match(/^u:(.+?):pr:(.+)$/);
            if (!match) continue;
            const [, userName, field] = match;
            await this.withRetry(() =>
              this.client.hSet(this.prHashKey(userName), field, raw)
            );
          }
          await this.withRetry(() => this.client.del(oldPrKeys));
          console.log(`遷移了 ${oldPrKeys.length} 條播放記錄`);
        }
      }

      // 遷移收藏：u:*:fav:* → u:username:fav (Hash)
      const favKeys = await this.withRetry(() => this.client.keys('u:*:fav:*'));
      if (favKeys.length > 0) {
        const oldFavKeys = favKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'fav' && parts[3] !== '';
        });

        if (oldFavKeys.length > 0) {
          const values = await this.withRetry(() =>
            this.client.mGet(oldFavKeys)
          );
          for (let i = 0; i < oldFavKeys.length; i++) {
            const raw = values[i];
            if (!raw) continue;
            const match = oldFavKeys[i].match(/^u:(.+?):fav:(.+)$/);
            if (!match) continue;
            const [, userName, field] = match;
            await this.withRetry(() =>
              this.client.hSet(this.favHashKey(userName), field, raw)
            );
          }
          await this.withRetry(() => this.client.del(oldFavKeys));
          console.log(`遷移了 ${oldFavKeys.length} 條收藏`);
        }
      }

      // 遷移 skipConfig：u:*:skip:* → u:username:skip (Hash)
      const skipKeys = await this.withRetry(() =>
        this.client.keys('u:*:skip:*')
      );
      if (skipKeys.length > 0) {
        const oldSkipKeys = skipKeys.filter((k) => {
          const parts = k.split(':');
          return parts.length >= 4 && parts[2] === 'skip' && parts[3] !== '';
        });

        if (oldSkipKeys.length > 0) {
          const values = await this.withRetry(() =>
            this.client.mGet(oldSkipKeys)
          );
          for (let i = 0; i < oldSkipKeys.length; i++) {
            const raw = values[i];
            if (!raw) continue;
            const match = oldSkipKeys[i].match(/^u:(.+?):skip:(.+)$/);
            if (!match) continue;
            const [, userName, field] = match;
            await this.withRetry(() =>
              this.client.hSet(this.skipHashKey(userName), field, raw)
            );
          }
          await this.withRetry(() => this.client.del(oldSkipKeys));
          console.log(`遷移了 ${oldSkipKeys.length} 條跳過設定`);
        }
      }

      // 遷移使用者列表：從 KEYS u:*:pwd 构建 sys:users Set
      const userSetExists = await this.withRetry(() =>
        this.client.exists(this.usersSetKey())
      );
      if (!userSetExists) {
        const pwdKeys = await this.withRetry(() => this.client.keys('u:*:pwd'));
        const userNames = pwdKeys
          .map((k) => {
            const match = k.match(/^u:(.+?):pwd$/);
            return match ? match[1] : undefined;
          })
          .filter((u): u is string => typeof u === 'string');
        if (userNames.length > 0) {
          await this.withRetry(() =>
            this.client.sAdd(this.usersSetKey(), userNames)
          );
          console.log(`遷移了 ${userNames.length} 個使用者到 Set`);
        }
      }

      // 標記遷移完成
      await this.withRetry(() => this.client.set(this.migrationKey(), 'done'));
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
    const migrated = await this.withRetry(() =>
      this.client.get(this.pwdMigrationKey())
    );
    if (migrated === 'done') return;

    console.log('開始密碼遷移：明文 → 加盐哈希...');

    try {
      const pwdKeys = await this.withRetry(() => this.client.keys('u:*:pwd'));
      let count = 0;

      for (const key of pwdKeys) {
        const stored = await this.withRetry(() => this.client.get(key));
        if (stored === null) continue;
        const storedStr = ensureString(stored);
        // 跳過已經是哈希格式的
        if (isHashed(storedStr)) continue;
        // 将明文密碼轉为加盐哈希
        const hashed = hashPassword(storedStr);
        await this.withRetry(() => this.client.set(key, hashed));
        count++;
      }

      await this.withRetry(() =>
        this.client.set(this.pwdMigrationKey(), 'done')
      );
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
    const raw = await this.withRetry(() =>
      this.client.hGet(this.bangumiAliasHashKey(), bangumiId)
    );
    return parseJsonValue<BangumiAliasCacheEntry>(
      raw,
      `${this.bangumiAliasHashKey()}/${bangumiId}`
    );
  }

  async setBangumiAliasCache(
    bangumiId: string,
    entry: BangumiAliasCacheEntry
  ): Promise<void> {
    await this.withRetry(() =>
      this.client.hSet(
        this.bangumiAliasHashKey(),
        bangumiId,
        JSON.stringify(entry)
      )
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
      await this.withRetry(() => this.client.del(this.adminConfigKey()));
      await this.withRetry(() => this.client.del(this.bangumiAliasHashKey()));

      console.log('所有數據已清空');
    } catch (error) {
      console.error('清空數據失敗:', error);
      throw new Error('清空數據失敗');
    }
  }
}
