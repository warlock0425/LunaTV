'use client';

// Keep the legacy MoonTV key so existing favorite tags survive upgrades.
const STORAGE_KEY = 'moontv_favorite_tags';

export interface FavoriteTag {
  name: string;
  color: string;
}

export function getFavoriteTags(): FavoriteTag[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + '_definitions');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveFavoriteTags(tags: FavoriteTag[]) {
  try {
    localStorage.setItem(STORAGE_KEY + '_definitions', JSON.stringify(tags));
  } catch {
    // 容量不足等寫入失敗不該中斷 UI 操作
  }
}

export function setItemTags(key: string, tags: string[]) {
  // 讀取沿用 getAllItemTags 的容錯：這裡原本直接 JSON.parse，資料毀損時
  // 會在點擊標籤的當下拋錯，連帶讓呼叫端後續的 setState 整個不執行。
  const map = getAllItemTags();
  map[key] = tags;
  try {
    localStorage.setItem(STORAGE_KEY + '_items', JSON.stringify(map));
  } catch {
    // 容量不足等寫入失敗不該中斷 UI 操作
  }
}

export function getAllItemTags(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + '_items');
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    // 值必須是字串陣列，否則呼叫端的 .filter / .includes 會拋錯
    const result: Record<string, string[]> = {};
    for (const [itemKey, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        result[itemKey] = value.filter(
          (tag): tag is string => typeof tag === 'string'
        );
      }
    }
    return result;
  } catch {
    return {};
  }
}
