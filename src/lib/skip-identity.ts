import { generateStorageKey } from './storage-key';

/** 與真實 CMS source key 錯開，避免寫入跳過設定時撞到片源名稱。 */
export const SKIP_IDENTITY_SOURCE = '_skip';

export type SkipIdentityParts = {
  source: typeof SKIP_IDENTITY_SOURCE;
  id: string;
};

function normalizeSkipTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（）()【】[\]『』「」·・.。]/g, '');
}

/** 穩定短雜湊：瀏覽器與 Node 都能用，不必等 Web Crypto。 */
export function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * 片頭片尾綁「這部片」而不是單一源。
 * 有豆瓣 ID 用 d{id}；否則用正規化標題＋年份的雜湊。
 */
export function makeSkipIdentityParts(input: {
  doubanId?: number | string | null;
  title?: string | null;
  year?: string | number | null;
}): SkipIdentityParts | null {
  const douban = Number(input.doubanId);
  if (Number.isFinite(douban) && douban > 0) {
    return { source: SKIP_IDENTITY_SOURCE, id: `d${Math.trunc(douban)}` };
  }

  const title =
    typeof input.title === 'string' ? normalizeSkipTitle(input.title) : '';
  if (!title) return null;
  const year = String(input.year ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
  return {
    source: SKIP_IDENTITY_SOURCE,
    id: `t${fnv1a32Hex(`${title}|${year}`)}`,
  };
}

export function makeSkipIdentityKey(input: {
  doubanId?: number | string | null;
  title?: string | null;
  year?: string | number | null;
}): string | null {
  const parts = makeSkipIdentityParts(input);
  if (!parts) return null;
  return generateStorageKey(parts.source, parts.id);
}
