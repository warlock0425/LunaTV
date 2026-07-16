'use client';

// Keep the legacy MoonTV key so existing favorite tags survive BerserkerTV upgrades.
const STORAGE_KEY = 'moontv_favorite_tags';

export interface FavoriteTag {
  name: string;
  color: string;
}

export function getFavoriteTags(): FavoriteTag[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + '_definitions');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveFavoriteTags(tags: FavoriteTag[]) {
  localStorage.setItem(STORAGE_KEY + '_definitions', JSON.stringify(tags));
}

export function setItemTags(key: string, tags: string[]) {
  const raw = localStorage.getItem(STORAGE_KEY + '_items');
  const map: Record<string, string[]> = raw ? JSON.parse(raw) : {};
  map[key] = tags;
  localStorage.setItem(STORAGE_KEY + '_items', JSON.stringify(map));
}

export function getAllItemTags(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + '_items');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
