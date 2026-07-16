'use client';

/**
 * 僅在瀏覽器端使用的資料庫工具（facade）。
 * 實作已依領域拆分至 ./db-client/*，此檔僅 re-export 維持既有 import 路徑不變。
 */

export { fetchWithAuth, generateStorageKey } from './db-client/api';
export { cacheManager } from './db-client/cache';
export * from './db-client/cache-sync';
export * from './db-client/favorites';
export * from './db-client/play-records';
export * from './db-client/search-history';
export type { Favorite, PlayRecord } from './db-client/shared';
export { STORAGE_TYPE } from './db-client/shared';
export * from './db-client/skip-configs';
