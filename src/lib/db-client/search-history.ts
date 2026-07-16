/* eslint-disable no-console */
'use client';

import {
  fetchFromApi,
  fetchWithAuth,
  handleDatabaseOperationFailure,
} from './api';
import { cacheManager } from './cache';
import {
  SEARCH_HISTORY_KEY,
  SEARCH_HISTORY_LIMIT,
  STORAGE_TYPE,
  triggerGlobalError,
} from './shared';
export async function getSearchHistory(): Promise<string[]> {
  // 服務器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return [];
  }

  // 數據庫存儲模式：使用混合緩存策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先從緩存獲取數據
    const cachedData = cacheManager.getCachedSearchHistory();

    if (cachedData) {
      // 返回緩存數據，同時后台異步更新
      fetchFromApi<string[]>(`/api/searchhistory`)
        .then((freshData) => {
          // 只有數據真正不同時才更新緩存
          if (JSON.stringify(cachedData) !== JSON.stringify(freshData)) {
            cacheManager.cacheSearchHistory(freshData);
            // 触發數據更新事件
            window.dispatchEvent(
              new CustomEvent('searchHistoryUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步搜索歷史失敗:', err);
          triggerGlobalError('后台同步搜索歷史失敗');
        });

      return cachedData;
    } else {
      // 緩存为空，直接從 API 獲取並緩存
      try {
        const freshData = await fetchFromApi<string[]>(`/api/searchhistory`);
        cacheManager.cacheSearchHistory(freshData);
        return freshData;
      } catch (err) {
        console.error('獲取搜索歷史失敗:', err);
        triggerGlobalError('獲取搜索歷史失敗');
        return [];
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    // 僅返回字符串數組
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.error('讀取搜索歷史失敗:', err);
    triggerGlobalError('讀取搜索歷史失敗');
    return [];
  }
}

/**
 * 将關键字添加到搜索歷史。
 * 數據庫存儲模式下使用乐觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function addSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim();
  if (!trimmed) return;

  // 資料庫存儲模式：樂觀更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 保存舊狀態以便 rollback
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const prevHistory = [...cachedHistory];
    const newHistory = [trimmed, ...cachedHistory.filter((k) => k !== trimmed)];
    // 限制長度
    if (newHistory.length > SEARCH_HISTORY_LIMIT) {
      newHistory.length = SEARCH_HISTORY_LIMIT;
    }
    cacheManager.cacheSearchHistory(newHistory);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );

    // 非同步同步到資料庫
    try {
      await fetchWithAuth('/api/searchhistory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ keyword: trimmed }),
      });
    } catch (err) {
      // 先 rollback 快取至原始狀態，再嘗試從 API 兜底刷新
      cacheManager.cacheSearchHistory(prevHistory);
      window.dispatchEvent(
        new CustomEvent('searchHistoryUpdated', {
          detail: prevHistory,
        })
      );
      await handleDatabaseOperationFailure('searchHistory', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;

  try {
    const history = await getSearchHistory();
    const newHistory = [trimmed, ...history.filter((k) => k !== trimmed)];
    // 限制長度
    if (newHistory.length > SEARCH_HISTORY_LIMIT) {
      newHistory.length = SEARCH_HISTORY_LIMIT;
    }
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );
  } catch (err) {
    console.error('保存搜索歷史失敗:', err);
    triggerGlobalError('保存搜索歷史失敗');
  }
}

/**
 * 清空搜索歷史。
 * 數據庫存儲模式下使用乐觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function clearSearchHistory(): Promise<void> {
  // 數據庫存儲模式：乐觀更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    cacheManager.cacheSearchHistory([]);

    // 触發立即更新事件
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: [],
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(`/api/searchhistory`, {
        method: 'DELETE',
      });
    } catch (err) {
      await handleDatabaseOperationFailure('searchHistory', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SEARCH_HISTORY_KEY);
  window.dispatchEvent(
    new CustomEvent('searchHistoryUpdated', {
      detail: [],
    })
  );
}

/**
 * 刪除單條搜索歷史。
 * 數據庫存儲模式下使用乐觀更新：先更新緩存，再異步同步到數據庫。
 */
export async function deleteSearchHistory(keyword: string): Promise<void> {
  const trimmed = keyword.trim();
  if (!trimmed) return;

  // 數據庫存儲模式：乐觀更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新緩存
    const cachedHistory = cacheManager.getCachedSearchHistory() || [];
    const newHistory = cachedHistory.filter((k) => k !== trimmed);
    cacheManager.cacheSearchHistory(newHistory);

    // 触發立即更新事件
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(
        `/api/searchhistory?keyword=${encodeURIComponent(trimmed)}`,
        {
          method: 'DELETE',
        }
      );
    } catch (err) {
      await handleDatabaseOperationFailure('searchHistory', err);
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;

  try {
    const history = await getSearchHistory();
    const newHistory = history.filter((k) => k !== trimmed);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(newHistory));
    window.dispatchEvent(
      new CustomEvent('searchHistoryUpdated', {
        detail: newHistory,
      })
    );
  } catch (err) {
    console.error('刪除搜索歷史失敗:', err);
    triggerGlobalError('刪除搜索歷史失敗');
  }
}
