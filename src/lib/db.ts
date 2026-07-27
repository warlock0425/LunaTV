/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from 'node:crypto';

import { AdminConfig } from './admin.types';
import type { BangumiAliasCacheEntry } from './bangumi-alias-storage';
import { KvrocksStorage } from './kvrocks.db';
import { getPlayRecordKeysToReplace } from './play-records';
import { RedisStorage } from './redis.db';
import {
  generateStorageKey as createStorageKey,
  parseStorageKey,
} from './storage-key';
import {
  getServerStorageType,
  getStorageRuntimeStatus,
} from './storage-runtime';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';
import { UpstashRedisStorage } from './upstash.db';

const STORAGE_TYPE = getServerStorageType();
const PLAY_RECORD_LOCK_TTL_MS = 30_000;
const PLAY_RECORD_LOCK_HEARTBEAT_MS = PLAY_RECORD_LOCK_TTL_MS / 3;
const PLAY_RECORD_LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
const PLAY_RECORD_LOCK_RETRY_MS = 50;

export { getStorageRuntimeStatus } from './storage-runtime';

function warnStorageDisabled(message: string): void {
  console.warn(
    `[Storage configuration] ${message}; reads will return empty data and writes will fail until it is fixed.`
  );
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(`Storage unavailable: ${message}`);
    this.name = 'StorageUnavailableError';
  }
}

export class StorageLockTimeoutError extends Error {
  constructor(key: string) {
    super(`Timed out acquiring storage lock: ${key}`);
    this.name = 'StorageLockTimeoutError';
  }
}

export class StorageLockLostError extends Error {
  constructor(key: string) {
    super(`Storage lock ownership was lost before release: ${key}`);
    this.name = 'StorageLockLostError';
  }
}

// localStorage 模式的伺服器端為空儲存；遠端設定缺失時仍允許讀取預設值，但拒絕所有寫入。

class NoopStorage implements IStorage {
  constructor(private readonly unavailableReason?: string) {}

  private assertWritable(): void {
    if (this.unavailableReason) {
      throw new StorageUnavailableError(this.unavailableReason);
    }
  }

  async getPlayRecord(): Promise<null> {
    return null;
  }
  async setPlayRecord(): Promise<void> {
    this.assertWritable();
  }
  async getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
    return {};
  }
  async deletePlayRecord(): Promise<void> {
    this.assertWritable();
  }
  async deleteAllPlayRecords(): Promise<void> {
    this.assertWritable();
  }
  async getFavorite(): Promise<null> {
    return null;
  }
  async setFavorite(): Promise<void> {
    this.assertWritable();
  }
  async getAllFavorites(): Promise<Record<string, Favorite>> {
    return {};
  }
  async deleteFavorite(): Promise<void> {
    this.assertWritable();
  }
  async deleteAllFavorites(): Promise<void> {
    this.assertWritable();
  }
  async registerUser(): Promise<void> {
    this.assertWritable();
  }
  async verifyUser(): Promise<boolean> {
    return false;
  }
  async checkUserExist(): Promise<boolean> {
    return false;
  }
  async changePassword(): Promise<void> {
    this.assertWritable();
  }
  async deleteUser(): Promise<void> {
    this.assertWritable();
  }
  async getSearchHistory(): Promise<string[]> {
    return [];
  }
  async addSearchHistory(): Promise<void> {
    this.assertWritable();
  }
  async deleteSearchHistory(): Promise<void> {
    this.assertWritable();
  }
  async getAllUsers(): Promise<string[]> {
    return [];
  }
  async getAdminConfig(): Promise<null> {
    return null;
  }
  async setAdminConfig(): Promise<void> {
    this.assertWritable();
  }
  async getBangumiAliasCache(): Promise<null> {
    return null;
  }
  async setBangumiAliasCache(): Promise<void> {
    this.assertWritable();
  }
  async getSkipConfig(): Promise<null> {
    return null;
  }
  async setSkipConfig(): Promise<void> {
    this.assertWritable();
  }
  async deleteSkipConfig(): Promise<void> {
    this.assertWritable();
  }
  async getAllSkipConfigs(): Promise<Record<string, SkipConfig>> {
    return {};
  }
  async clearAllData(): Promise<void> {
    this.assertWritable();
  }
}

function createStorage(): IStorage {
  const status = getStorageRuntimeStatus();

  if (!status.configured) {
    warnStorageDisabled(`${status.message} - ${status.type} storage disabled`);
    return new NoopStorage(status.message);
  }

  switch (STORAGE_TYPE) {
    case 'redis':
      if (!process.env.REDIS_URL) {
        warnStorageDisabled('REDIS_URL is not set — Redis storage disabled');
        return new NoopStorage('REDIS_URL is not set');
      }
      return new RedisStorage();
    case 'upstash':
      if (!process.env.UPSTASH_URL || !process.env.UPSTASH_TOKEN) {
        warnStorageDisabled(
          'UPSTASH_URL/UPSTASH_TOKEN not set — Upstash storage disabled'
        );
        return new NoopStorage('UPSTASH_URL/UPSTASH_TOKEN is not set');
      }
      return new UpstashRedisStorage();
    case 'kvrocks':
      if (!process.env.KVROCKS_URL) {
        warnStorageDisabled(
          'KVROCKS_URL is not set — Kvrocks storage disabled'
        );
        return new NoopStorage('KVROCKS_URL is not set');
      }
      return new KvrocksStorage();
    case 'localstorage':
    default:
      return new NoopStorage();
  }
}

// 單例儲存實例
let storageInstance: IStorage | null = null;

function getStorage(): IStorage {
  if (!storageInstance) {
    storageInstance = createStorage();
  }
  return storageInstance;
}

// 工具函数：生成存储key
export function generateStorageKey(source: string, id: string): string {
  return createStorageKey(source, id);
}

// 匯出便捷方法
export class DbManager {
  private storage: IStorage;
  private migrationPromise: Promise<void> | null = null;
  private playRecordMutationQueues = new Map<string, Promise<void>>();

  constructor(storage: IStorage = getStorage()) {
    this.storage = storage;
    // 啟動時自動觸發資料遷移（非同步，不阻塞建構）
    if (this.storage && typeof this.storage.migrateData === 'function') {
      this.migrationPromise = this.storage
        .migrateData()
        .then(async () => {
          // 資料結構遷移完成後，執行密碼雜湊遷移
          if (typeof this.storage.migratePasswords === 'function') {
            await this.storage.migratePasswords();
          }
        })
        .catch((err) => {
          console.error('資料遷移異常:', err);
        });
    }
  }

  /** 等待迁移完成（内部方法，首次调用后 migrationPromise 会被置空） */
  private async ensureMigrated(): Promise<void> {
    if (this.migrationPromise) {
      await this.migrationPromise;
      this.migrationPromise = null;
    }
  }

  private async runPlayRecordMutation<T>(
    userName: string,
    mutation: () => Promise<T>
  ): Promise<T> {
    const previous = this.playRecordMutationQueues.get(userName);
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const queueTail = (previous || Promise.resolve())
      .catch(() => undefined)
      .then(() => current);

    this.playRecordMutationQueues.set(userName, queueTail);
    await previous?.catch(() => undefined);

    try {
      return await this.runDistributedPlayRecordMutation(userName, mutation);
    } finally {
      releaseCurrent();
      if (this.playRecordMutationQueues.get(userName) === queueTail) {
        this.playRecordMutationQueues.delete(userName);
      }
    }
  }

  private async runDistributedPlayRecordMutation<T>(
    userName: string,
    mutation: () => Promise<T>
  ): Promise<T> {
    const acquireLock = this.storage.acquireLock;
    const renewLock = this.storage.renewLock;
    const releaseLock = this.storage.releaseLock;
    if (!acquireLock && !renewLock && !releaseLock) return mutation();
    if (!acquireLock || !renewLock || !releaseLock) {
      throw new Error(
        'Storage must implement acquireLock, renewLock, and releaseLock together'
      );
    }

    const lockKey = `lock:play-records:${userName}`;
    const ownerToken = randomUUID();
    const deadline = Date.now() + PLAY_RECORD_LOCK_ACQUIRE_TIMEOUT_MS;
    let acquired = false;

    while (!acquired) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new StorageLockTimeoutError(lockKey);

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        acquired = await Promise.race([
          acquireLock.call(
            this.storage,
            lockKey,
            ownerToken,
            PLAY_RECORD_LOCK_TTL_MS
          ),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new StorageLockTimeoutError(lockKey)),
              remainingMs
            );
          }),
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (!acquired) {
        const delayMs = Math.min(
          PLAY_RECORD_LOCK_RETRY_MS,
          Math.max(0, deadline - Date.now())
        );
        if (delayMs === 0) throw new StorageLockTimeoutError(lockKey);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    let heartbeatStopped = false;
    let heartbeatError: unknown;
    let renewalInFlight: Promise<void> | null = null;
    const heartbeatTimer = setInterval(() => {
      if (heartbeatStopped || heartbeatError || renewalInFlight) return;
      renewalInFlight = (async () => {
        try {
          const renewed = await renewLock.call(
            this.storage,
            lockKey,
            ownerToken,
            PLAY_RECORD_LOCK_TTL_MS
          );
          if (!renewed) heartbeatError = new StorageLockLostError(lockKey);
        } catch (error) {
          heartbeatError = error;
        } finally {
          renewalInFlight = null;
        }
      })();
    }, PLAY_RECORD_LOCK_HEARTBEAT_MS);

    let result!: T;
    let mutationFailed = false;
    let mutationError: unknown;
    try {
      result = await mutation();
    } catch (error) {
      mutationFailed = true;
      mutationError = error;
    }

    heartbeatStopped = true;
    clearInterval(heartbeatTimer);
    await renewalInFlight;

    const released = await releaseLock.call(this.storage, lockKey, ownerToken);
    // mutation 本身的錯誤優先回報：它才是呼叫端需要看到的根因。
    // 反過來先丟 StorageLockLostError 會把真正的失敗原因整個吃掉。
    if (mutationFailed) throw mutationError;
    if (!released) throw new StorageLockLostError(lockKey);
    if (heartbeatError) throw heartbeatError;
    return result;
  }

  // 播放紀錄相關方法
  async getPlayRecord(
    userName: string,
    source: string,
    id: string
  ): Promise<PlayRecord | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord
  ): Promise<void> {
    // 沿用作者的 source + id 作為播放紀錄唯一鍵，避免同名影片互相覆蓋。
    await this.runPlayRecordMutation(userName, async () => {
      const storageKey = createStorageKey(source, id);
      const enrichedRecord = {
        ...record,
        vod_id: id,
        source,
      };
      const targetRecord = { ...enrichedRecord, key: storageKey };
      const existingRecords =
        (await this.storage.getAllPlayRecords(userName)) || {};
      const keysToReplace = getPlayRecordKeysToReplace(
        existingRecords,
        targetRecord
      );
      const newestExistingSaveTime = keysToReplace.reduce(
        (latest, key) =>
          Math.max(latest, Number(existingRecords[key]?.save_time || 0)),
        0
      );

      // Delayed requests from this or a replaced source must not roll progress back.
      if (newestExistingSaveTime > Number(enrichedRecord.save_time || 0)) {
        return;
      }

      const keysToDelete = new Set(keysToReplace);
      keysToDelete.delete(storageKey);
      for (const key of Array.from(keysToDelete)) {
        await this.storage.deletePlayRecord(userName, key);
      }

      await this.storage.setPlayRecord(userName, storageKey, enrichedRecord);
    });
  }

  async getAllPlayRecords(userName: string): Promise<{
    [key: string]: PlayRecord;
  }> {
    await this.ensureMigrated();
    return this.storage.getAllPlayRecords(userName);
  }

  async deletePlayRecord(
    userName: string,
    source: string,
    id: string,
    _meta?: { title?: string; sourceName?: string }
  ): Promise<void> {
    // 只刪除同一個 source + id 的紀錄，避免同名影片或不同片源被誤刪。
    await this.runPlayRecordMutation(userName, async () => {
      const allRecords = await this.storage.getAllPlayRecords(userName);
      const storageKey = createStorageKey(source, id);
      const keysToDelete = new Set<string>([storageKey]);
      if (allRecords) {
        for (const [key, record] of Object.entries(allRecords)) {
          if (!record) continue;
          const parsedKey = parseStorageKey(key);
          const recordSource = record.source || parsedKey?.source || '';
          const recordId =
            record.vod_id || (record as any).id || parsedKey?.id || '';
          if (recordSource === source && String(recordId) === String(id)) {
            keysToDelete.add(key);
          }
        }
      }
      for (const key of Array.from(keysToDelete)) {
        await this.storage.deletePlayRecord(userName, key);
      }
    });
  }

  async deleteAllPlayRecords(userName: string): Promise<void> {
    await this.runPlayRecordMutation(userName, () =>
      this.storage.deleteAllPlayRecords(userName)
    );
  }

  // 收藏相關方法
  async getFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<Favorite | null> {
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.setFavorite(userName, key, favorite);
  }

  async getAllFavorites(
    userName: string
  ): Promise<{ [key: string]: Favorite }> {
    await this.ensureMigrated();
    return this.storage.getAllFavorites(userName);
  }

  async deleteFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await this.storage.deleteAllFavorites(userName);
  }

  async isFavorited(
    userName: string,
    source: string,
    id: string
  ): Promise<boolean> {
    const favorite = await this.getFavorite(userName, source, id);
    return favorite !== null;
  }

  // ---------- 使用者相關 ----------
  async registerUser(userName: string, password: string): Promise<void> {
    await this.storage.registerUser(userName, password);
  }

  async verifyUser(userName: string, password: string): Promise<boolean> {
    return this.storage.verifyUser(userName, password);
  }

  // 检查用户是否已存在
  async checkUserExist(userName: string): Promise<boolean> {
    return this.storage.checkUserExist(userName);
  }

  async changePassword(userName: string, newPassword: string): Promise<void> {
    await this.storage.changePassword(userName, newPassword);
  }

  async deleteUser(userName: string): Promise<void> {
    await this.storage.deleteUser(userName);
  }

  // ---------- 搜索历史 ----------
  async getSearchHistory(userName: string): Promise<string[]> {
    return this.storage.getSearchHistory(userName);
  }

  async addSearchHistory(userName: string, keyword: string): Promise<void> {
    await this.storage.addSearchHistory(userName, keyword);
  }

  async deleteSearchHistory(userName: string, keyword?: string): Promise<void> {
    await this.storage.deleteSearchHistory(userName, keyword);
  }

  // 获取全部用户名
  async getAllUsers(): Promise<string[]> {
    if (typeof (this.storage as any).getAllUsers === 'function') {
      return (this.storage as any).getAllUsers();
    }
    return [];
  }

  // ---------- 管理员設定 ----------
  async getAdminConfig(): Promise<AdminConfig | null> {
    if (typeof (this.storage as any).getAdminConfig === 'function') {
      return (this.storage as any).getAdminConfig();
    }
    return null;
  }

  async saveAdminConfig(config: AdminConfig): Promise<void> {
    if (typeof (this.storage as any).setAdminConfig === 'function') {
      await (this.storage as any).setAdminConfig(config);
    }
  }

  // ---------- 跳过片头片尾設定 ----------
  async getBangumiAliasCache(
    bangumiId: string
  ): Promise<BangumiAliasCacheEntry | null> {
    if (typeof (this.storage as any).getBangumiAliasCache === 'function') {
      return (this.storage as any).getBangumiAliasCache(bangumiId);
    }
    return null;
  }

  async setBangumiAliasCache(
    bangumiId: string,
    entry: BangumiAliasCacheEntry
  ): Promise<void> {
    if (typeof (this.storage as any).setBangumiAliasCache === 'function') {
      await (this.storage as any).setBangumiAliasCache(bangumiId, entry);
    }
  }

  async getSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<SkipConfig | null> {
    if (typeof (this.storage as any).getSkipConfig === 'function') {
      return (this.storage as any).getSkipConfig(userName, source, id);
    }
    return null;
  }

  async setSkipConfig(
    userName: string,
    source: string,
    id: string,
    config: SkipConfig
  ): Promise<void> {
    if (typeof (this.storage as any).setSkipConfig === 'function') {
      await (this.storage as any).setSkipConfig(userName, source, id, config);
    }
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    if (typeof (this.storage as any).deleteSkipConfig === 'function') {
      await (this.storage as any).deleteSkipConfig(userName, source, id);
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    if (typeof (this.storage as any).getAllSkipConfigs === 'function') {
      return (this.storage as any).getAllSkipConfigs(userName);
    }
    return {};
  }

  // ---------- 数据清理 ----------
  async clearAllData(): Promise<void> {
    if (typeof (this.storage as any).clearAllData === 'function') {
      await (this.storage as any).clearAllData();
    } else {
      throw new Error('儲存類型不支援清空資料操作');
    }
  }
}

// 匯出預設實例
export const db = new DbManager();
