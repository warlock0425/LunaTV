'use client';

import {
  fetchFromApi,
  fetchWithAuth,
  generateStorageKey,
  handleDatabaseOperationFailure,
} from './api';
import { cacheManager } from './cache';
import {
  getPlayRecordKeysToDelete,
  isSameCachedData,
  PLAY_RECORDS_KEY,
  PlayRecord,
  STORAGE_TYPE,
  triggerGlobalError,
} from './shared';

/**
 * 儲存播放進度後，最短多久才允許再次向伺服器重抓整份播放紀錄。
 * 換集一定會立即重抓，不受此限制；此值只用來節流「純進度心跳」。
 */
const REFRESH_MIN_INTERVAL_MS = 60_000;
let lastRemoteRefreshAt = 0;

/** 供測試重置節流狀態（模組層狀態會跨測試殘留）。 */
export function __resetPlayRecordRefreshThrottle(): void {
  lastRemoteRefreshAt = 0;
}

// ---- API ----
/**
 * 讀取全部播放記錄。
 * 非本地存儲模式下使用混合快取策略：优先返回快取數據，后台異步同步最新數據。
 * 在服務端渲染阶段 (window === undefined) 時返回空對象，避免報錯。
 */
export async function getAllPlayRecords(): Promise<Record<string, PlayRecord>> {
  // 服務器端渲染阶段直接返回空，交由客戶端 useEffect 再行請求
  if (typeof window === 'undefined') {
    return {};
  }

  // 數據庫存儲模式：使用混合快取策略（包括 redis 和 upstash）
  if (STORAGE_TYPE !== 'localstorage') {
    // 优先從快取取得數據
    const cachedData = cacheManager.getCachedPlayRecords();

    if (cachedData) {
      // 返回快取數據，同時后台異步更新
      fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`)
        .then((freshData) => {
          // 只有數據真正不同時才更新快取
          if (!isSameCachedData(cachedData, freshData)) {
            cacheManager.cachePlayRecords(freshData);
            // 触發數據更新事件，供組件監听
            window.dispatchEvent(
              new CustomEvent('playRecordsUpdated', {
                detail: freshData,
              })
            );
          }
        })
        .catch((err) => {
          console.warn('后台同步播放記錄失敗:', err);
        });

      return cachedData;
    } else {
      // 快取为空，直接從 API 取得並快取
      try {
        const freshData =
          await fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`);
        cacheManager.cachePlayRecords(freshData);
        return freshData;
      } catch (err) {
        console.error('取得播放記錄失敗:', err);
        triggerGlobalError('取得播放記錄失敗');
        return {};
      }
    }
  }

  // localstorage 模式
  try {
    const raw = localStorage.getItem(PLAY_RECORDS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PlayRecord>;
  } catch (err) {
    console.error('讀取播放記錄失敗:', err);
    triggerGlobalError('讀取播放記錄失敗');
    return {};
  }
}

export function savePlayRecordOnPageExit(
  source: string,
  id: string,
  record: PlayRecord
): void {
  if (typeof window === 'undefined' || !source || !id || !record) return;

  const key = generateStorageKey(source, id);
  const enrichedRecord = {
    ...record,
    vod_id: id,
    source,
  };
  try {
    if (STORAGE_TYPE === 'localstorage') {
      const raw = localStorage.getItem(PLAY_RECORDS_KEY);
      const allRecords = raw
        ? (JSON.parse(raw) as Record<string, PlayRecord>)
        : {};
      const nextRecords = { ...allRecords };
      nextRecords[key] = enrichedRecord;
      localStorage.setItem(PLAY_RECORDS_KEY, JSON.stringify(nextRecords));
      window.dispatchEvent(
        new CustomEvent('playRecordsUpdated', {
          detail: nextRecords,
        })
      );
      return;
    }

    const cachedRecords = cacheManager.getCachedPlayRecords();
    if (cachedRecords) {
      const nextCachedRecords = { ...cachedRecords };
      nextCachedRecords[key] = enrichedRecord;
      cacheManager.cachePlayRecords(nextCachedRecords);
      window.dispatchEvent(
        new CustomEvent('playRecordsUpdated', {
          detail: nextCachedRecords,
        })
      );
    }

    const payload = JSON.stringify({ key, record: enrichedRecord });
    if (navigator.sendBeacon) {
      const body = new Blob([payload], { type: 'application/json' });
      if (navigator.sendBeacon('/api/playrecords', body)) {
        return;
      }
    }

    fetchWithAuth('/api/playrecords', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Page-exit persistence is best-effort; regular interval saves still run.
    });
  } catch {
    // Page-exit persistence must not block unload/navigation.
  }
}

/**
 * 儲存播放記錄。
 * 數據庫存儲模式下使用乐觀更新：先更新快取（立即生效），再異步同步到數據庫。
 */
export async function savePlayRecord(
  source: string,
  id: string,
  record: PlayRecord
): Promise<void> {
  const key = generateStorageKey(source, id);
  const enrichedRecord = {
    ...record,
    vod_id: id,
    source: source,
  };
  // 資料庫存儲模式：POST 成功後從 API 取得最新資料覆蓋快取。
  // 以服務端回傳資料作為最終狀態，避免樂觀快取和遠端資料不同步。
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedRecords = cacheManager.getCachedPlayRecords();
    const prevRecords = cachedRecords ? { ...cachedRecords } : null;
    // 判斷是否為「換集」：集數或總集數變動時，務必以伺服器資料為準重新整理
    // （這正是先前修「集數永不更新」時要保住的行為）。單純的播放進度心跳
    // 則不需要每次都把整份清單重抓一遍。
    const previousRecord = cachedRecords?.[key];
    const episodeChanged =
      !previousRecord ||
      previousRecord.index !== enrichedRecord.index ||
      previousRecord.total_episodes !== enrichedRecord.total_episodes;
    if (cachedRecords) {
      const nextCachedRecords = { ...cachedRecords };
      nextCachedRecords[key] = enrichedRecord;
      cacheManager.cachePlayRecords(nextCachedRecords);
      window.dispatchEvent(
        new CustomEvent('playRecordsUpdated', {
          detail: nextCachedRecords,
        })
      );
    }

    // 先同步到資料庫。只有這一步失敗才代表播放紀錄沒有儲存成功。
    try {
      await fetchWithAuth('/api/playrecords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, record: enrichedRecord }),
      });
    } catch (err) {
      // 若 POST 失敗且有先前快取，rollback 至原始狀態
      if (prevRecords) {
        cacheManager.cachePlayRecords(prevRecords);
        window.dispatchEvent(
          new CustomEvent('playRecordsUpdated', {
            detail: prevRecords,
          })
        );
      }
      console.error('儲存播放紀錄失敗:', err);
      triggerGlobalError(
        err instanceof Error
          ? `儲存播放紀錄失敗：${err.message}`
          : '儲存播放紀錄失敗'
      );
      throw err;
    }

    // POST 已成功。重新整理列表若暫時失敗，不應回滾或誤報成儲存失敗。
    //
    // 播放期間每 5 秒就會存一次進度，若每次都重抓整份播放紀錄，等於每分鐘
    // 多下載十幾 KB 只為了確認剛寫進去的東西。因此只在真正需要時才重抓：
    //   1) 換集（集數/總集數變動）— 必須以伺服器為準；
    //   2) 距離上次重抓超過 REFRESH_MIN_INTERVAL_MS — 讓其他裝置的變更仍能同步進來。
    const now = Date.now();
    if (
      !episodeChanged &&
      now - lastRemoteRefreshAt < REFRESH_MIN_INTERVAL_MS
    ) {
      return;
    }
    lastRemoteRefreshAt = now;

    try {
      const freshData =
        await fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`);
      cacheManager.cachePlayRecords(freshData);
      window.dispatchEvent(
        new CustomEvent('playRecordsUpdated', {
          detail: freshData,
        })
      );
    } catch (refreshError) {
      console.warn('播放紀錄已儲存，但重新整理播放紀錄快取失敗:', refreshError);
    }
    return;
  }

  // localstorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端儲存播放記錄到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();
    const nextRecords = { ...allRecords };
    nextRecords[key] = enrichedRecord;
    localStorage.setItem(PLAY_RECORDS_KEY, JSON.stringify(nextRecords));
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: nextRecords,
      })
    );
  } catch (err) {
    console.error('儲存播放記錄失敗:', err);
    triggerGlobalError('儲存播放記錄失敗');
    throw err;
  }
}

/**
 * 刪除播放記錄。
 * 數據庫存儲模式下使用乐觀更新：先更新快取，再異步同步到數據庫。
 */
export async function deletePlayRecord(
  source: string,
  id: string,
  recordMeta?: Pick<PlayRecord, 'title' | 'source_name'>
): Promise<void> {
  const key = generateStorageKey(source, id);
  const query = new URLSearchParams({ key });
  if (recordMeta?.title) query.set('title', recordMeta.title);
  if (recordMeta?.source_name) query.set('source_name', recordMeta.source_name);

  // 數據庫存儲模式
  if (STORAGE_TYPE !== 'localstorage') {
    const cachedRecords = cacheManager.getCachedPlayRecords() || {};
    const prevRecords = { ...cachedRecords };
    const keysToDelete = getPlayRecordKeysToDelete(
      cachedRecords,
      key,
      source,
      id
    );
    // 複製後再刪：getCachedPlayRecords 回傳的是快取記憶體內的活引用，
    // 就地 delete 會在還沒寫回 localStorage 之前就改動 memo，讓 memo 與
    // 實際儲存內容不一致。其餘同檔案的寫入路徑本來就是複製後再改。
    const nextRecords = { ...cachedRecords };
    keysToDelete.forEach((k) => {
      delete nextRecords[k];
    });
    cacheManager.cachePlayRecords(nextRecords);
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: nextRecords,
      })
    );

    try {
      await fetchWithAuth(`/api/playrecords?${query.toString()}`, {
        method: 'DELETE',
      });

      const freshData =
        await fetchFromApi<Record<string, PlayRecord>>(`/api/playrecords`);
      cacheManager.cachePlayRecords(freshData);
      window.dispatchEvent(
        new CustomEvent('playRecordsUpdated', {
          detail: freshData,
        })
      );
    } catch (err) {
      cacheManager.cachePlayRecords(prevRecords);
      window.dispatchEvent(
        new CustomEvent('playRecordsUpdated', {
          detail: prevRecords,
        })
      );
      await handleDatabaseOperationFailure('playRecords', err);
      triggerGlobalError('刪除播放記錄失敗');
      throw err;
    }
    return;
  }

  // localstorage 模式
  if (typeof window === 'undefined') {
    console.warn('無法在服務端刪除播放記錄到 localStorage');
    return;
  }

  try {
    const allRecords = await getAllPlayRecords();

    const keysToDelete = getPlayRecordKeysToDelete(allRecords, key, source, id);
    keysToDelete.forEach((k) => {
      delete allRecords[k];
    });

    localStorage.setItem(PLAY_RECORDS_KEY, JSON.stringify(allRecords));
    window.dispatchEvent(
      new CustomEvent('playRecordsUpdated', {
        detail: allRecords,
      })
    );
  } catch (err) {
    console.error('刪除播放記錄失敗:', err);
    triggerGlobalError('刪除播放記錄失敗');
    throw err;
  }
}

/* ---------------- 搜索歷史相關 API ---------------- */

/**
 * 取得搜索歷史。
 * 數據庫存儲模式下使用混合快取策略：优先返回快取數據，后台異步同步最新數據。
 */

export async function clearAllPlayRecords(): Promise<void> {
  // 數據庫存儲模式
  if (STORAGE_TYPE !== 'localstorage') {
    // 異步同步到數據庫
    try {
      await fetchWithAuth(`/api/playrecords`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      // 刪除成功后更新快取並触發事件，避免竞態導致讀取旧數據
      cacheManager.cachePlayRecords({});
      window.dispatchEvent(
        new CustomEvent('playRecordsUpdated', {
          detail: {},
        })
      );
    } catch (err) {
      await handleDatabaseOperationFailure('playRecords', err);
      triggerGlobalError('清空播放記錄失敗');
      throw err;
    }
    return;
  }

  // localStorage 模式
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PLAY_RECORDS_KEY);
  window.dispatchEvent(
    new CustomEvent('playRecordsUpdated', {
      detail: {},
    })
  );
}

/**
 * 清空全部收藏
 * 數據庫存儲模式下使用乐觀更新：先更新快取，再異步同步到數據庫。
 */
