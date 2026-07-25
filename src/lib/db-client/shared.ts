'use client';

import { parseStorageKey } from '../storage-key';
import { normalizeStorageType } from '../storage-runtime';

// ---- 全局錯誤觸發 ----
// 全局錯誤触發函數
export function triggerGlobalError(message: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('globalError', {
        detail: { message },
      })
    );
  }
}

// ---- 快取比對 ----
/**
 * 背景同步時判斷「資料是否真的變了」。
 *
 * 取代原本的 `JSON.stringify(a) !== JSON.stringify(b)`：
 * 1) 不再配置兩份完整字串，遇到第一個差異即短路返回；
 * 2) 不受物件鍵順序影響——伺服器回傳順序改變不會再被誤判為已變更，
 *    因而省下無謂的快取寫入與全域事件觸發（後者會造成整頁重繪）。
 *
 * 語意刻意對齊 JSON.stringify：值為 undefined 的鍵視同不存在，
 * 兩個 NaN 視為相同，確保行為與舊實作一致。
 */
export function isSameCachedData(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (typeof a === 'number' && typeof b === 'number') {
    // JSON.stringify 會把 NaN 序列化為 null，因此舊實作視兩個 NaN 相同
    return Number.isNaN(a) && Number.isNaN(b);
  }

  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  ) {
    return false;
  }

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i += 1) {
      if (!isSameCachedData(arrA[i], arrB[i])) return false;
    }
    return true;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  // 值為 undefined 的鍵不列入比較，對齊 JSON.stringify 的省略行為
  const keysA = Object.keys(objA).filter((key) => objA[key] !== undefined);
  const keysB = Object.keys(objB).filter((key) => objB[key] !== undefined);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (objB[key] === undefined) return false;
    if (!isSameCachedData(objA[key], objB[key])) return false;
  }
  return true;
}

// ---- 類型 ----
export interface PlayRecord {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  index: number; // 第几集
  total_episodes: number; // 總集數
  play_time: number; // 播放進度（秒）
  total_time: number; // 總進度（秒）
  save_time: number; // 記錄儲存時間（時間戳）
  search_title?: string; // 搜索時使用的標題
  id?: string;
  vod_id?: string;
  source?: string;
}

export function getPlayRecordKeysToDelete(
  records: Record<string, PlayRecord>,
  key: string,
  source: string,
  id: string
): string[] {
  const keysToDelete = [key];
  for (const [recordKey, record] of Object.entries(records)) {
    if (!record) continue;
    const parsedKey = parseStorageKey(recordKey);
    const recordSource = record.source || parsedKey?.source || '';
    const recordId = record.vod_id || record.id || parsedKey?.id || '';
    const sameDirectRecord =
      recordSource === source && String(recordId) === String(id);
    if (sameDirectRecord) {
      keysToDelete.push(recordKey);
    }
  }
  return Array.from(new Set(keysToDelete));
}

// ---- 收藏類型 ----
export interface Favorite {
  title: string;
  source_name: string;
  year: string;
  cover: string;
  total_episodes: number;
  save_time: number;
  search_title?: string;
  origin?: 'vod' | 'live';
}

// ---- 常量 ----
// Keep legacy MoonTV localStorage keys for data compatibility across upgrades.
export const PLAY_RECORDS_KEY = 'moontv_play_records';
export const FAVORITES_KEY = 'moontv_favorites';
export const SEARCH_HISTORY_KEY = 'moontv_search_history';

// ---- 環境變數 ----
export const STORAGE_TYPE = (() => {
  const raw =
    (typeof window !== 'undefined' && window.RUNTIME_CONFIG?.STORAGE_TYPE) ||
    (process.env.STORAGE_TYPE as
      'localstorage' | 'redis' | 'upstash' | 'kvrocks' | undefined) ||
    (process.env.NEXT_PUBLIC_STORAGE_TYPE as
      'localstorage' | 'redis' | 'upstash' | 'kvrocks' | undefined) ||
    'localstorage';
  return normalizeStorageType(raw);
})();

// ---- 搜索歷史相關常量 ----
// 搜索歷史最大儲存條數
export const SEARCH_HISTORY_LIMIT = 20;
