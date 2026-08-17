'use client';

import {
  fetchFromApi,
  fetchWithAuth,
  generateStorageKey,
  handleDatabaseOperationFailure,
} from './api';
import { cacheManager } from './cache';
import { isSameCachedData, STORAGE_TYPE, triggerGlobalError } from './shared';
import { SkipConfig } from '../types';
// ------------- 跳過片头片尾設定相關 API -------------

/**
 * 取得跳過片头片尾設定。
 * 數據庫存儲模式下使用混合快取策略：优先返回快取數據，后台異步同步最新數據。
 */
export async function getSkipConfig(
  source: string,
  id: string
): Promise<SkipConfig | null> {
  // 服務器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return null;
  }

  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：使用混合快取策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先從快取取得數據
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      // 返回快取數據，同時后台異步更新
      fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`)
        .then((freshData) => {
          // 只有數據真正不同時才更新快取
          if (!isSameCachedData(cachedData, freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            // 触發數據更新事件
            window.dispatchEvent(
              new CustomEvent('skipConfigsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步跳過片头片尾設定失敗:', err);
        });

      return cachedData[key] || null;
    } else {
      // 快取为空，直接從 API 取得並快取
      try {
        const freshData =
          await fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`);
        cacheManager.cacheSkipConfigs(freshData);
        return freshData[key] || null;
      } catch (err) {
        console.error('取得跳過片头片尾設定失敗:', err);
        triggerGlobalError('取得跳過片头片尾設定失敗');
        return null;
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    if (!raw) return null;
    const configs = JSON.parse(raw) as Record<string, SkipConfig>;
    return configs[key] || null;
  } catch (err) {
    console.error('讀取跳過片头片尾設定失敗:', err);
    triggerGlobalError('讀取跳過片头片尾設定失敗');
    return null;
  }
}

/**
 * 儲存跳過片头片尾設定。
 * 數據庫存儲模式下使用乐觀更新：先更新快取，再異步同步到數據庫。
 */
export async function saveSkipConfig(
  source: string,
  id: string,
  config: SkipConfig
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 資料庫存儲模式：樂觀更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 儲存舊狀態以便 rollback
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    const prevConfigs = { ...cachedConfigs };

    // 立即更新快取。複製後再寫：getCachedSkipConfigs 回傳的是快取記憶體內的活
    // 引用，就地寫入會連帶改掉 getAllSkipConfigs 背景同步時所持有的比較基準，
    // 導致同步用還沒有這筆設定的舊資料覆蓋快取。
    // （delete 路徑在 d4ef76f 已因同樣理由改成複製後再刪。）
    const nextConfigs = { ...cachedConfigs, [key]: config };
    cacheManager.cacheSkipConfigs(nextConfigs);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('skipConfigsUpdated', {
        detail: nextConfigs,
      })
    );

    // 異步同步到資料庫
    try {
      await fetchWithAuth('/api/skipconfigs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, config }),
      });
    } catch (err) {
      // 發生錯誤，回滾快取與 UI 狀態，並向上拋出錯誤
      cacheManager.cacheSkipConfigs(prevConfigs);
      window.dispatchEvent(
        new CustomEvent('skipConfigsUpdated', {
          detail: prevConfigs,
        })
      );
      await handleDatabaseOperationFailure('skipConfigs', err);
      triggerGlobalError('儲存跳過片頭片尾設定失敗');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端儲存跳過片头片尾設定到 localStorage');
    return;
  }

  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    const configs = raw ? (JSON.parse(raw) as Record<string, SkipConfig>) : {};
    configs[key] = config;
    localStorage.setItem('moontv_skip_configs', JSON.stringify(configs));
    window.dispatchEvent(
      new CustomEvent('skipConfigsUpdated', {
        detail: configs,
      })
    );
  } catch (err) {
    console.error('儲存跳過片头片尾設定失敗:', err);
    triggerGlobalError('儲存跳過片头片尾設定失敗');
    throw err;
  }
}

/**
 * 取得所有跳過片头片尾設定。
 * 數據庫存儲模式下使用混合快取策略：优先返回快取數據，后台異步同步最新數據。
 */
export async function getAllSkipConfigs(): Promise<Record<string, SkipConfig>> {
  // 服務器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return {};
  }

  // 數據庫存儲模式：使用混合快取策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先從快取取得數據
    const cachedData = cacheManager.getCachedSkipConfigs();

    if (cachedData) {
      // 返回快取數據，同時后台異步更新
      fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`)
        .then((freshData) => {
          // 只有數據真正不同時才更新快取
          if (!isSameCachedData(cachedData, freshData)) {
            cacheManager.cacheSkipConfigs(freshData);
            // 触發數據更新事件
            window.dispatchEvent(
              new CustomEvent('skipConfigsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步跳過片头片尾設定失敗:', err);
        });

      return cachedData;
    } else {
      // 快取为空，直接從 API 取得並快取
      try {
        const freshData =
          await fetchFromApi<Record<string, SkipConfig>>(`/api/skipconfigs`);
        cacheManager.cacheSkipConfigs(freshData);
        return freshData;
      } catch (err) {
        console.error('取得跳過片头片尾設定失敗:', err);
        triggerGlobalError('取得跳過片头片尾設定失敗');
        return {};
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, SkipConfig>;
  } catch (err) {
    console.error('讀取跳過片头片尾設定失敗:', err);
    triggerGlobalError('讀取跳過片头片尾設定失敗');
    return {};
  }
}

/**
 * 刪除跳過片头片尾設定。
 * 數據庫存儲模式下使用乐觀更新：先更新快取，再異步同步到數據庫。
 */
export async function deleteSkipConfig(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 資料庫存儲模式：樂觀更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 儲存舊狀態以便 rollback
    const cachedConfigs = cacheManager.getCachedSkipConfigs() || {};
    const prevConfigs = { ...cachedConfigs };

    // 立即更新快取。複製後再刪：getCachedSkipConfigs 回傳的是快取記憶體內的
    // 活引用，就地 delete 會讓 memo 與實際儲存內容不一致。
    const nextConfigs = { ...cachedConfigs };
    delete nextConfigs[key];
    cacheManager.cacheSkipConfigs(nextConfigs);

    // 觸發立即更新事件
    window.dispatchEvent(
      new CustomEvent('skipConfigsUpdated', {
        detail: nextConfigs,
      })
    );

    // 異步同步到資料庫
    try {
      await fetchWithAuth(`/api/skipconfigs?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      // 發生錯誤，回滾快取與 UI 狀態，並向上拋出錯誤
      cacheManager.cacheSkipConfigs(prevConfigs);
      window.dispatchEvent(
        new CustomEvent('skipConfigsUpdated', {
          detail: prevConfigs,
        })
      );
      await handleDatabaseOperationFailure('skipConfigs', err);
      triggerGlobalError('刪除跳過片頭片尾設定失敗');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端刪除跳過片头片尾設定到 localStorage');
    return;
  }

  try {
    const raw = localStorage.getItem('moontv_skip_configs');
    if (raw) {
      const configs = JSON.parse(raw) as Record<string, SkipConfig>;
      delete configs[key];
      localStorage.setItem('moontv_skip_configs', JSON.stringify(configs));
      window.dispatchEvent(
        new CustomEvent('skipConfigsUpdated', {
          detail: configs,
        })
      );
    }
  } catch (err) {
    console.error('刪除跳過片头片尾設定失敗:', err);
    triggerGlobalError('刪除跳過片头片尾設定失敗');
    throw err;
  }
}
