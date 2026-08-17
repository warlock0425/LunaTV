'use client';

import {
  fetchFromApi,
  fetchWithAuth,
  generateStorageKey,
  handleDatabaseOperationFailure,
} from './api';
import { cacheManager } from './cache';
import {
  Favorite,
  FAVORITES_KEY,
  isSameCachedData,
  STORAGE_TYPE,
  triggerGlobalError,
} from './shared';
// ---------------- 收藏相關 API ----------------

/**
 * 取得全部收藏。
 * 數據庫存儲模式下使用混合快取策略：优先返回快取數據，后台異步同步最新數據。
 */
export async function getAllFavorites(): Promise<Record<string, Favorite>> {
  // 服務器端渲染阶段直接返回空
  if (typeof window === 'undefined') {
    return {};
  }

  // 數據庫存儲模式：使用混合快取策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先從快取取得數據
    const cachedData = cacheManager.getCachedFavorites();

    if (cachedData) {
      // 返回快取數據，同時后台異步更新
      fetchFromApi<Record<string, Favorite>>(`/api/favorites`)
        .then((freshData) => {
          // 只有數據真正不同時才更新快取
          if (!isSameCachedData(cachedData, freshData)) {
            cacheManager.cacheFavorites(freshData);
            // 触發數據更新事件
            window.dispatchEvent(
              new CustomEvent('favoritesUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步收藏失敗:', err);
        });

      return cachedData;
    } else {
      // 快取为空，直接從 API 取得並快取
      try {
        const freshData =
          await fetchFromApi<Record<string, Favorite>>(`/api/favorites`);
        cacheManager.cacheFavorites(freshData);
        return freshData;
      } catch (err) {
        console.error('取得收藏失敗:', err);
        triggerGlobalError('取得收藏失敗');
        return {};
      }
    }
  }

  // localStorage 模式
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, Favorite>;
  } catch (err) {
    console.error('讀取收藏失敗:', err);
    triggerGlobalError('讀取收藏失敗');
    return {};
  }
}

/**
 * 儲存收藏。
 * 數據庫存儲模式下使用乐觀更新：先更新快取，再異步同步到數據庫。
 */
export async function saveFavorite(
  source: string,
  id: string,
  favorite: Favorite
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：乐觀更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新快取。複製後再寫：getCachedFavorites 回傳的是快取記憶體內的活引用，
    // 就地寫入會連帶改掉 getAllFavorites 背景同步時所持有的比較基準——那份基準
    // 一旦含有剛存下的收藏，isSameCachedData 就會判定與伺服器資料不同，於是用
    // 還沒有這筆收藏的舊資料覆蓋快取，使用者剛按的收藏無聲消失。
    // （delete 路徑在 d4ef76f 已因同樣理由改成複製後再刪。）
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    const prevFavorites = { ...cachedFavorites };
    const nextFavorites = { ...cachedFavorites, [key]: favorite };
    cacheManager.cacheFavorites(nextFavorites);

    // 触發立即更新事件
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: nextFavorites,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, favorite }),
      });
    } catch (err) {
      cacheManager.cacheFavorites(prevFavorites);
      window.dispatchEvent(
        new CustomEvent('favoritesUpdated', {
          detail: prevFavorites,
        })
      );
      await handleDatabaseOperationFailure('favorites', err);
      triggerGlobalError('儲存收藏失敗');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端儲存收藏到 localStorage');
    return;
  }

  try {
    const allFavorites = await getAllFavorites();
    allFavorites[key] = favorite;
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(allFavorites));
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: allFavorites,
      })
    );
  } catch (err) {
    console.error('儲存收藏失敗:', err);
    triggerGlobalError('儲存收藏失敗');
    throw err;
  }
}

/**
 * 刪除收藏。
 * 數據庫存儲模式下使用乐觀更新：先更新快取，再異步同步到數據庫。
 */
export async function deleteFavorite(
  source: string,
  id: string
): Promise<void> {
  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：乐觀更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 立即更新快取
    const cachedFavorites = cacheManager.getCachedFavorites() || {};
    const prevFavorites = { ...cachedFavorites };
    // 複製後再刪：getCachedFavorites 回傳的是快取記憶體內的活引用
    const nextFavorites = { ...cachedFavorites };
    delete nextFavorites[key];
    cacheManager.cacheFavorites(nextFavorites);

    // 触發立即更新事件
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: nextFavorites,
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(`/api/favorites?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      cacheManager.cacheFavorites(prevFavorites);
      window.dispatchEvent(
        new CustomEvent('favoritesUpdated', {
          detail: prevFavorites,
        })
      );
      await handleDatabaseOperationFailure('favorites', err);
      triggerGlobalError('刪除收藏失敗');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端刪除收藏到 localStorage');
    return;
  }

  try {
    const allFavorites = await getAllFavorites();
    delete allFavorites[key];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(allFavorites));
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: allFavorites,
      })
    );
  } catch (err) {
    console.error('刪除收藏失敗:', err);
    triggerGlobalError('刪除收藏失敗');
    throw err;
  }
}

/**
 * 判斷是否已收藏。
 * 數據庫存儲模式下使用混合快取策略：优先返回快取數據，后台異步同步最新數據。
 */
export async function isFavorited(
  source: string,
  id: string
): Promise<boolean> {
  const key = generateStorageKey(source, id);

  // 數據庫存儲模式：使用混合快取策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedFavorites = cacheManager.getCachedFavorites();

    if (cachedFavorites) {
      // 返回快取數據，同時后台異步更新
      fetchFromApi<Record<string, Favorite>>(`/api/favorites`)
        .then((freshData) => {
          // 只有數據真正不同時才更新快取
          if (!isSameCachedData(cachedFavorites, freshData)) {
            cacheManager.cacheFavorites(freshData);
            // 触發數據更新事件
            window.dispatchEvent(
              new CustomEvent('favoritesUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步收藏失敗:', err);
        });

      return !!cachedFavorites[key];
    } else {
      // 快取为空，直接從 API 取得並快取
      try {
        const freshData =
          await fetchFromApi<Record<string, Favorite>>(`/api/favorites`);
        cacheManager.cacheFavorites(freshData);
        return !!freshData[key];
      } catch (err) {
        console.error('檢查收藏狀態失敗:', err);
        triggerGlobalError('檢查收藏狀態失敗');
        return false;
      }
    }
  }

  // localStorage 模式
  const allFavorites = await getAllFavorites();
  return !!allFavorites[key];
}

/**
 * 清空全部播放記錄
 * 數據庫存儲模式下使用乐觀更新：先更新快取，再異步同步到數據庫。
 */

export async function clearAllFavorites(): Promise<void> {
  // 數據庫存儲模式：乐觀更新策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    const prevFavorites = cacheManager.getCachedFavorites() || {};
    // 立即更新快取
    cacheManager.cacheFavorites({});

    // 触發立即更新事件
    window.dispatchEvent(
      new CustomEvent('favoritesUpdated', {
        detail: {},
      })
    );

    // 異步同步到數據庫
    try {
      await fetchWithAuth(`/api/favorites`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      cacheManager.cacheFavorites(prevFavorites);
      window.dispatchEvent(
        new CustomEvent('favoritesUpdated', {
          detail: prevFavorites,
        })
      );
      await handleDatabaseOperationFailure('favorites', err);
      triggerGlobalError('清空收藏失敗');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  localStorage.removeItem(FAVORITES_KEY);
  window.dispatchEvent(
    new CustomEvent('favoritesUpdated', {
      detail: {},
    })
  );
}
