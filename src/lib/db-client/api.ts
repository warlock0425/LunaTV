/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { cacheManager } from './cache';
import { Favorite, PlayRecord, triggerGlobalError } from './shared';
import { generateStorageKey as createStorageKey } from '../storage-key';
import { SkipConfig } from '../types';

// ---- 錯誤處理辅助函數 ----
/**
 * 數據庫操作失敗時的通用錯誤處理
 * 立即從數據庫重新整理對應類型的快取以保持數據一致性
 */
export async function handleDatabaseOperationFailure(
  dataType: 'playRecords' | 'favorites' | 'searchHistory' | 'skipConfigs',
  error: any
): Promise<void> {
  console.error(`資料庫操作失敗 (${dataType}):`, error);
  triggerGlobalError(`資料庫操作失敗`);

  try {
    let freshData: any;
    let eventName: string;

    switch (dataType) {
      case 'playRecords':
        freshData =
          await fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`);
        cacheManager.cachePlayRecords(freshData);
        eventName = 'playRecordsUpdated';
        break;
      case 'favorites':
        freshData =
          await fetchFromApi<Record<string, Favorite>>(`/api/favorites`);
        cacheManager.cacheFavorites(freshData);
        eventName = 'favoritesUpdated';
        break;
      case 'searchHistory':
        freshData = await fetchFromApi<string[]>(`/api/searchhistory`);
        cacheManager.cacheSearchHistory(freshData);
        eventName = 'searchHistoryUpdated';
        break;
      case 'skipConfigs':
        freshData =
          await fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`);
        cacheManager.cacheSkipConfigs(freshData);
        eventName = 'skipConfigsUpdated';
        break;
      default:
        return;
    }

    // 觸發更新事件通知組件
    window.dispatchEvent(
      new CustomEvent(eventName, {
        detail: freshData,
      })
    );
  } catch (refreshErr) {
    console.error(`重新整理${dataType}快取失敗:`, refreshErr);
    triggerGlobalError(`重新整理${dataType}快取失敗`);
  }
}

// ---- 工具函數 ----
/**
 * 通用的 fetch 函數，處理 401 狀態碼自動跳轉登錄
 */
export async function fetchWithAuth(
  url: string,
  options?: RequestInit
): Promise<Response> {
  const res = await fetch(url, options);
  if (!res.ok) {
    // 如果是 401 未授權，跳轉到登錄頁面
    if (res.status === 401) {
      // 調用 logout 接口
      try {
        await fetch('/api/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        console.error('注銷請求失敗:', error);
      }
      const currentUrl = window.location.pathname + window.location.search;
      const loginUrl = new URL('/login', window.location.origin);
      loginUrl.searchParams.set('redirect', currentUrl);
      window.location.href = loginUrl.toString();
      throw new Error('使用者未授權，已跳轉到登錄頁面');
    }

    let responseMessage = '';
    try {
      const payload = (await res.clone().json()) as {
        error?: unknown;
        message?: unknown;
      };
      const candidate = payload.error || payload.message;
      if (typeof candidate === 'string') {
        responseMessage = candidate.trim();
      }
    } catch {
      // Non-JSON error responses fall back to the HTTP status below.
    }

    throw new Error(
      responseMessage
        ? `請求 ${url} 失敗 (${res.status})：${responseMessage}`
        : `請求 ${url} 失敗 (${res.status})`
    );
  }
  return res;
}

export async function fetchFromApi<T>(path: string): Promise<T> {
  const res = await fetchWithAuth(path, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  return (await res.json()) as T;
}

/**
 * 生成存儲key
 */
export function generateStorageKey(source: string, id: string): string {
  return createStorageKey(source, id);
}
