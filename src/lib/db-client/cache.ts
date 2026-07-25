/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { Favorite, PlayRecord } from './shared';
import { getAuthInfoFromBrowserCookie } from '../auth';
import { SkipConfig } from '../types';

// ---- 快取數據結构 ----
interface CacheData<T> {
  data: T;
  timestamp: number;
  version: string;
}

interface UserCacheStore {
  playRecords?: CacheData<Record<string, PlayRecord>>;
  favorites?: CacheData<Record<string, Favorite>>;
  searchHistory?: CacheData<string[]>;
  skipConfigs?: CacheData<Record<string, SkipConfig>>;
}

// 快取相關常量
const CACHE_PREFIX = 'moontv_cache_';
const CACHE_VERSION = '1.0.0';
const CACHE_EXPIRE_TIME = 60 * 60 * 1000; // 一小時快取過期

// ---- 快取管理器 ----
class HybridCacheManager {
  private static instance: HybridCacheManager;

  /**
   * 已解析快取的記憶體備份。
   *
   * 播放期間每 5 秒存一次播放紀錄，每次存檔會多次讀寫快取；若每次都對整份
   * blob（所有播放紀錄＋收藏＋搜尋歷史＋跳過設定）做 JSON.parse，會在主執行緒
   * 造成可感知的卡頓。這裡以 localStorage 原始字串為鍵記憶解析結果：字串沒變就
   * 直接重用，字串一變（含其他分頁寫入）就自動失效重新解析，兼顧效能與正確性。
   */
  private memo: {
    cacheKey: string;
    raw: string;
    store: UserCacheStore;
  } | null = null;

  static getInstance(): HybridCacheManager {
    if (!HybridCacheManager.instance) {
      HybridCacheManager.instance = new HybridCacheManager();
    }
    return HybridCacheManager.instance;
  }

  /**
   * 取得目前使用者名
   */
  private getCurrentUsername(): string | null {
    const authInfo = getAuthInfoFromBrowserCookie();
    return authInfo?.username || null;
  }

  /**
   * 生成使用者专屬的快取key
   */
  private getUserCacheKey(username: string): string {
    return `${CACHE_PREFIX}${username}`;
  }

  /**
   * 取得使用者快取數據
   */
  private getUserCache(username: string): UserCacheStore {
    if (typeof window === 'undefined') return {};

    try {
      const cacheKey = this.getUserCacheKey(username);
      const cached = localStorage.getItem(cacheKey);
      if (!cached) {
        this.memo = null;
        return {};
      }

      // 原始字串未變 ⇒ 重用上次的解析結果，省下整份 blob 的 JSON.parse
      if (this.memo?.cacheKey === cacheKey && this.memo.raw === cached) {
        return this.memo.store;
      }

      const store = JSON.parse(cached) as UserCacheStore;
      this.memo = { cacheKey, raw: cached, store };
      return store;
    } catch (error) {
      console.warn('取得使用者快取失敗:', error);
      this.memo = null;
      return {};
    }
  }

  /**
   * 儲存使用者快取數據
   */
  private saveUserCache(username: string, cache: UserCacheStore): void {
    if (typeof window === 'undefined') return;

    try {
      // 只序列化一次：序列化結果同時用於大小檢查與寫入。
      // 僅在真的觸發清理（會就地改動 cache）時才需要重新序列化。
      let serialized = JSON.stringify(cache);
      if (serialized.length > 15 * 1024 * 1024) {
        console.warn('快取過大，清理旧數據');
        this.cleanOldCache(cache);
        serialized = JSON.stringify(cache);
      }

      const cacheKey = this.getUserCacheKey(username);
      localStorage.setItem(cacheKey, serialized);
      this.memo = { cacheKey, raw: serialized, store: cache };
    } catch (error) {
      console.warn('儲存使用者快取失敗:', error);
      this.memo = null;
      // 存儲空間不足時清理快取后重試
      if (
        error instanceof DOMException &&
        error.name === 'QuotaExceededError'
      ) {
        this.clearAllCache();
        try {
          const cacheKey = this.getUserCacheKey(username);
          const retrySerialized = JSON.stringify(cache);
          localStorage.setItem(cacheKey, retrySerialized);
          this.memo = { cacheKey, raw: retrySerialized, store: cache };
        } catch (retryError) {
          console.error('重試儲存快取仍然失敗:', retryError);
        }
      }
    }
  }

  /**
   * 清理過期快取數據
   */
  private cleanOldCache(cache: UserCacheStore): void {
    const now = Date.now();
    const maxAge = 60 * 24 * 60 * 60 * 1000; // 两個月

    // 清理過期的播放記錄快取
    if (cache.playRecords && now - cache.playRecords.timestamp > maxAge) {
      delete cache.playRecords;
    }

    // 清理過期的收藏快取
    if (cache.favorites && now - cache.favorites.timestamp > maxAge) {
      delete cache.favorites;
    }
  }

  /**
   * 清理所有快取
   */
  private clearAllCache(): void {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith('moontv_cache_')) {
        localStorage.removeItem(key);
      }
    });
    this.memo = null;
  }

  /**
   * 檢查快取是否有效
   */
  private isCacheValid<T>(cache: CacheData<T>): boolean {
    const now = Date.now();
    return (
      cache.version === CACHE_VERSION &&
      now - cache.timestamp < CACHE_EXPIRE_TIME
    );
  }

  /**
   * 創建快取數據
   */
  private createCacheData<T>(data: T): CacheData<T> {
    return {
      data,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };
  }

  /**
   * 取得快取的播放記錄
   */
  getCachedPlayRecords(): Record<string, PlayRecord> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.playRecords;

    if (cached && this.isCacheValid(cached) && cached.data) {
      return cached.data;
    }

    return null;
  }

  /**
   * 快取播放記錄
   */
  cachePlayRecords(data: Record<string, PlayRecord>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.playRecords = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 取得快取的收藏
   */
  getCachedFavorites(): Record<string, Favorite> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.favorites;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 快取收藏
   */
  cacheFavorites(data: Record<string, Favorite>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.favorites = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 取得快取的搜索歷史
   */
  getCachedSearchHistory(): string[] | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.searchHistory;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 快取搜索歷史
   */
  cacheSearchHistory(data: string[]): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.searchHistory = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 取得快取的跳過片头片尾設定
   */
  getCachedSkipConfigs(): Record<string, SkipConfig> | null {
    const username = this.getCurrentUsername();
    if (!username) return null;

    const userCache = this.getUserCache(username);
    const cached = userCache.skipConfigs;

    if (cached && this.isCacheValid(cached)) {
      return cached.data;
    }

    return null;
  }

  /**
   * 快取跳過片头片尾設定
   */
  cacheSkipConfigs(data: Record<string, SkipConfig>): void {
    const username = this.getCurrentUsername();
    if (!username) return;

    const userCache = this.getUserCache(username);
    userCache.skipConfigs = this.createCacheData(data);
    this.saveUserCache(username, userCache);
  }

  /**
   * 清除指定使用者的所有快取
   */
  clearUserCache(username?: string): void {
    const targetUsername = username || this.getCurrentUsername();
    if (!targetUsername) return;

    try {
      const cacheKey = this.getUserCacheKey(targetUsername);
      localStorage.removeItem(cacheKey);
      this.memo = null;
    } catch (error) {
      console.warn('清除使用者快取失敗:', error);
      this.memo = null;
    }
  }

  /**
   * 清除所有過期快取
   */
  clearExpiredCaches(): void {
    if (typeof window === 'undefined') return;

    try {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_PREFIX)) {
          try {
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            // 檢查是否有任何快取數據過期
            let hasValidData = false;
            for (const [, cacheData] of Object.entries(cache)) {
              if (cacheData && this.isCacheValid(cacheData as CacheData<any>)) {
                hasValidData = true;
                break;
              }
            }
            if (!hasValidData) {
              keysToRemove.push(key);
            }
          } catch {
            // 解析失敗的快取也刪除
            keysToRemove.push(key);
          }
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
      if (keysToRemove.length > 0) this.memo = null;
    } catch (error) {
      console.warn('清除過期快取失敗:', error);
      this.memo = null;
    }
  }
}

// 取得快取管理器實例
export const cacheManager = HybridCacheManager.getInstance();

// 頁面載入時清理過期快取
if (typeof window !== 'undefined') {
  setTimeout(() => cacheManager.clearExpiredCaches(), 1000);
}
