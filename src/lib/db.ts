/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomUUID } from 'node:crypto';

import { AdminConfig } from './admin.types';
import type { BangumiAliasCacheEntry } from './bangumi-alias-storage';
import { KvrocksStorage } from './kvrocks.db';
import { RedisStorage } from './redis.db';
import {
  generateStorageKey as createStorageKey,
  parseStorageKey,
} from './storage-key';
import {
  getServerStorageType,
  getStorageRuntimeStatus,
} from './storage-runtime';
import { cleanSourceName, normalizePlayRecordTitle } from './string-utils';
import { Favorite, IStorage, PlayRecord, SkipConfig } from './types';
import { UpstashRedisStorage } from './upstash.db';

const STORAGE_TYPE = getServerStorageType();
const PLAY_RECORD_LOCK_TTL_MS = 30_000;
const PLAY_RECORD_LOCK_HEARTBEAT_MS = PLAY_RECORD_LOCK_TTL_MS / 3;
const PLAY_RECORD_LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
const PLAY_RECORD_LOCK_RETRY_MS = 50;

/** 管理設定讀改寫共用鎖（與播放紀錄同一套分散式鎖原語） */
const ADMIN_CONFIG_LOCK_KEY = 'lock:admin-config';
const ADMIN_CONFIG_LOCK_TTL_MS = 30_000;
const ADMIN_CONFIG_LOCK_HEARTBEAT_MS = ADMIN_CONFIG_LOCK_TTL_MS / 3;
const ADMIN_CONFIG_LOCK_ACQUIRE_TIMEOUT_MS = 10_000;
const ADMIN_CONFIG_LOCK_RETRY_MS = 50;

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
  /** 行程內序列化管理設定寫入（與分散式鎖疊加） */
  private adminConfigMutationQueue: Promise<void> = Promise.resolve();

  constructor(storage: IStorage = getStorage()) {
    this.storage = storage;
    // 啟動時自動觸發資料遷移（非同步，不阻塞建構）
    if (this.storage && typeof this.storage.migrateData === 'function') {
      this.migrationPromise = this.startMigration();
    }
  }

  private startMigration(): Promise<void> {
    return this.storage.migrateData!().then(async () => {
      if (typeof this.storage.migratePasswords === 'function') {
        await this.storage.migratePasswords();
      }
    });
  }

  /** 等待遷移完成。失敗會清掉 promise，讓下一次讀寫再試。 */
  private async ensureMigrated(): Promise<void> {
    if (typeof this.storage.migrateData !== 'function') return;
    if (!this.migrationPromise) {
      this.migrationPromise = this.startMigration();
    }
    try {
      await this.migrationPromise;
      this.migrationPromise = null;
    } catch (error) {
      this.migrationPromise = null;
      console.error('資料遷移異常:', error);
      throw error;
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
    await this.ensureMigrated();

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
    return this.runWithDistributedLock(
      `lock:play-records:${userName}`,
      mutation,
      {
        ttlMs: PLAY_RECORD_LOCK_TTL_MS,
        heartbeatMs: PLAY_RECORD_LOCK_HEARTBEAT_MS,
        acquireTimeoutMs: PLAY_RECORD_LOCK_ACQUIRE_TIMEOUT_MS,
        retryMs: PLAY_RECORD_LOCK_RETRY_MS,
      }
    );
  }

  /**
   * 管理設定的讀→改→寫必須整段在鎖內完成。
   * 呼叫端應在 fn 內用 getFreshConfig()（或 db.getAdminConfig）重讀，
   * 不可沿用鎖外先讀好的快取草稿。
   */
  async withAdminConfigLock<T>(fn: () => Promise<T>): Promise<T> {
    let releaseCurrent!: () => void;
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const previous = this.adminConfigMutationQueue;
    this.adminConfigMutationQueue = previous
      .catch(() => undefined)
      .then(() => current);

    await previous.catch(() => undefined);
    try {
      return await this.runWithDistributedLock(ADMIN_CONFIG_LOCK_KEY, fn, {
        ttlMs: ADMIN_CONFIG_LOCK_TTL_MS,
        heartbeatMs: ADMIN_CONFIG_LOCK_HEARTBEAT_MS,
        acquireTimeoutMs: ADMIN_CONFIG_LOCK_ACQUIRE_TIMEOUT_MS,
        retryMs: ADMIN_CONFIG_LOCK_RETRY_MS,
      });
    } finally {
      releaseCurrent();
    }
  }

  /**
   * 多副本 cron：搶不到鎖就立刻放棄，不要卡住呼叫端。
   * 沒有分散式鎖的儲存（localStorage）會直接執行。
   */
  async tryCronLock(fn: () => Promise<void>): Promise<'ran' | 'busy'> {
    try {
      await this.runWithDistributedLock('lock:cron', fn, {
        ttlMs: 10 * 60 * 1000,
        heartbeatMs: 20 * 1000,
        acquireTimeoutMs: 250,
        retryMs: 50,
      });
      return 'ran';
    } catch (error) {
      if (error instanceof StorageLockTimeoutError) return 'busy';
      throw error;
    }
  }

  private async runWithDistributedLock<T>(
    lockKey: string,
    mutation: () => Promise<T>,
    timing: {
      ttlMs: number;
      heartbeatMs: number;
      acquireTimeoutMs: number;
      retryMs: number;
    }
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

    const ownerToken = randomUUID();
    const deadline = Date.now() + timing.acquireTimeoutMs;
    let acquired = false;

    while (!acquired) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new StorageLockTimeoutError(lockKey);

      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const acquirePromise = Promise.resolve(
        acquireLock.call(this.storage, lockKey, ownerToken, timing.ttlMs)
      );
      try {
        acquired = await Promise.race([
          acquirePromise,
          new Promise<boolean>((resolve) => {
            timeoutId = setTimeout(() => {
              timedOut = true;
              resolve(false);
            }, remainingMs);
          }),
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      if (timedOut) {
        void acquirePromise
          .then((won) => {
            if (won) {
              return releaseLock.call(this.storage, lockKey, ownerToken);
            }
          })
          .catch(() => undefined);
        throw new StorageLockTimeoutError(lockKey);
      }

      if (!acquired) {
        const delayMs = Math.min(
          timing.retryMs,
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
            timing.ttlMs
          );
          if (!renewed) heartbeatError = new StorageLockLostError(lockKey);
        } catch (error) {
          heartbeatError = error;
        } finally {
          renewalInFlight = null;
        }
      })();
    }, timing.heartbeatMs);

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
    await this.ensureMigrated();
    const key = generateStorageKey(source, id);
    return this.storage.getPlayRecord(userName, key);
  }

  async savePlayRecord(
    userName: string,
    source: string,
    id: string,
    record: PlayRecord
  ): Promise<void> {
    // 每把 source+id 獨立保存。同片名去重只在 UI，這裡不刪其他源。
    await this.runPlayRecordMutation(userName, async () => {
      const storageKey = createStorageKey(source, id);
      const existing = await this.storage.getPlayRecord(userName, storageKey);
      if (
        existing &&
        Number(existing.save_time || 0) > Number(record.save_time || 0)
      ) {
        return;
      }

      await this.storage.setPlayRecord(userName, storageKey, {
        ...record,
        vod_id: id,
        source,
      });
    });
  }

  /**
   * 只更新同一把 source+id 的標題／封面／集數，不改進度、不碰跨源去重。
   * cron 刷新集數必須走這裡，不能呼叫 savePlayRecord。
   */
  async updatePlayRecordMetadata(
    userName: string,
    source: string,
    id: string,
    patch: {
      total_episodes: number;
      title?: string;
      cover?: string;
      year?: string;
    }
  ): Promise<boolean> {
    return this.runPlayRecordMutation(userName, async () => {
      const storageKey = createStorageKey(source, id);
      const existing = await this.storage.getPlayRecord(userName, storageKey);
      if (!existing) return false;

      const nextEpisodes = Number(patch.total_episodes);
      if (!Number.isInteger(nextEpisodes) || nextEpisodes < 1) return false;
      if (nextEpisodes <= Number(existing.total_episodes || 0)) return false;

      const nextTitle = patch.title?.trim();
      await this.storage.setPlayRecord(userName, storageKey, {
        ...existing,
        total_episodes: nextEpisodes,
        title: nextTitle || existing.title,
        cover: patch.cover || existing.cover,
        year: patch.year || existing.year,
        vod_id: id,
        source,
      });
      return true;
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

  async deletePlayRecordsByTitle(
    userName: string,
    title: string,
    sourceName?: string
  ): Promise<number> {
    const targetTitle = normalizePlayRecordTitle(title);
    if (!targetTitle) return 0;
    const sourceForMatch = sourceName ? cleanSourceName(sourceName) : '';

    return this.runPlayRecordMutation(userName, async () => {
      const records = (await this.storage.getAllPlayRecords(userName)) || {};
      let deleted = 0;
      for (const [key, record] of Object.entries(records)) {
        if (!record) continue;
        const recordTitle = normalizePlayRecordTitle(
          record.title || (record as { vod_name?: string }).vod_name || ''
        );
        if (recordTitle !== targetTitle) continue;
        if (sourceForMatch) {
          const matchesSource = [record.source, record.source_name]
            .map((value) => cleanSourceName(value))
            .includes(sourceForMatch);
          if (!matchesSource) continue;
        }
        await this.storage.deletePlayRecord(userName, key);
        deleted += 1;
      }
      return deleted;
    });
  }

  // 收藏相關方法
  async getFavorite(
    userName: string,
    source: string,
    id: string
  ): Promise<Favorite | null> {
    await this.ensureMigrated();
    const key = generateStorageKey(source, id);
    return this.storage.getFavorite(userName, key);
  }

  async saveFavorite(
    userName: string,
    source: string,
    id: string,
    favorite: Favorite
  ): Promise<void> {
    await this.ensureMigrated();
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
    await this.ensureMigrated();
    const key = generateStorageKey(source, id);
    await this.storage.deleteFavorite(userName, key);
  }

  async deleteAllFavorites(userName: string): Promise<void> {
    await this.ensureMigrated();
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
    await this.ensureMigrated();
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
    await this.ensureMigrated();
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
    await this.ensureMigrated();
    if (typeof (this.storage as any).setSkipConfig === 'function') {
      await (this.storage as any).setSkipConfig(userName, source, id, config);
    }
  }

  async deleteSkipConfig(
    userName: string,
    source: string,
    id: string
  ): Promise<void> {
    await this.ensureMigrated();
    if (typeof (this.storage as any).deleteSkipConfig === 'function') {
      await (this.storage as any).deleteSkipConfig(userName, source, id);
    }
  }

  async getAllSkipConfigs(
    userName: string
  ): Promise<{ [key: string]: SkipConfig }> {
    await this.ensureMigrated();
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
