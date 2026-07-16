'use client';

import { parseStorageKey } from '../storage-key';

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
  save_time: number; // 記錄保存時間（時間戳）
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
  return raw;
})();

// ---- 搜索歷史相關常量 ----
// 搜索歷史最大保存條數
export const SEARCH_HISTORY_LIMIT = 20;
