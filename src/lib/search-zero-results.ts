import { db } from './db';
import { logger } from './logger';
import { getServerStorageType } from './storage-runtime';

/**
 * 站級「搜尋零結果」收集：只存查詢詞 + 次數 + 最後時間，不綁使用者。
 * 用途：站長補 regional-title-aliases 時的真實依據，不是個人隱私紀錄。
 *
 * 儲存：借用 DbManager 既有 Redis／Upstash／Kvrocks client（保活、重連、Symbol 單例），
 * 不以本模組再開第二套連線。資料用 hash：
 *   countHash[query] = 次數（HINCRBY 原子遞增）
 *   lastHash[query]  = 最後時間（HSET）
 * localstorage／無 client 時退回進程內 Map。
 */

export type SearchZeroResultEntry = {
  query: string;
  count: number;
  lastAt: number;
};

export const SEARCH_ZERO_RESULTS_MAX_ENTRIES = 100;
export const SEARCH_ZERO_RESULTS_MAX_QUERY_LEN = 80;

/** v2：hash 欄位結構；勿再寫回 v1 整包 JSON */
const COUNT_HASH_KEY = 'search:zero-results:count:v2';
const LAST_HASH_KEY = 'search:zero-results:last:v2';

const CJK_PATTERN = /[\u3400-\u9fff]/;
// 僅用於 .replace()。帶 /g 的 RegExp 若用 .test() 會受 lastIndex 影響，勿對此常數呼叫 .test()
const KANA_PATTERN = /[\u3040-\u30ff]/g;

type MemoryStore = Map<string, { count: number; lastAt: number }>;

const globalZeroResults = globalThis as typeof globalThis & {
  __berserkerSearchZeroResultsMap?: MemoryStore;
};

function memoryStore(): MemoryStore {
  globalZeroResults.__berserkerSearchZeroResultsMap ??= new Map();
  return globalZeroResults.__berserkerSearchZeroResultsMap;
}

/** node-redis / Upstash 方言不同，呼叫端依 kind 分支；client 形狀不統一故用 unknown */
type BorrowedStorageClient = {
  client: unknown;
  kind: 'redis' | 'upstash';
};

/**
 * 借用 db 層 storage.client（與 storage.ts 相同做法）。
 * 不 createClient／不 new UpstashRedis——保活與重連留在既有單例上。
 */
function getBorrowedClient(): BorrowedStorageClient | null {
  const storageType = getServerStorageType();
  if (storageType === 'localstorage') return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 與 storage.ts 相同：DbManager.storage 未公開型別
  const storageImpl = (db as any).storage as
    { client?: unknown } | null | undefined;
  if (!storageImpl?.client) return null;

  if (storageType === 'upstash') {
    return { client: storageImpl.client, kind: 'upstash' };
  }
  if (storageType === 'redis' || storageType === 'kvrocks') {
    return { client: storageImpl.client, kind: 'redis' };
  }
  return null;
}

/** hash 指令依方言呼叫；簽名不統一，以 unknown 承接後在本函式內斷言 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HashClient = any;

/** trim + 收合空白；不合格回 null */
export function normalizeZeroResultQuery(raw: string): string | null {
  const q = (raw || '').trim().replace(/\s+/g, ' ');
  if (!q || q.length > SEARCH_ZERO_RESULTS_MAX_QUERY_LEN) return null;
  // 只收中日韓漢字查詢：台譯表要補的是這類；英文片名靠原文搜即可
  if (!CJK_PATTERN.test(q)) return null;
  // 去掉全部假名後若已無漢字，視為假名為主，不進譯名表候選
  if (!CJK_PATTERN.test(q.replace(KANA_PATTERN, ''))) {
    return null;
  }
  return q;
}

export function sortZeroResultEntries(
  entries: SearchZeroResultEntry[]
): SearchZeroResultEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.count - a.count ||
      b.lastAt - a.lastAt ||
      a.query.localeCompare(b.query, 'zh-Hant')
  );
}

/**
 * 純函式：寫入一筆零結果查詢並裁到 maxEntries。
 * 記憶體路徑與單測用；Redis 路徑走 HINCRBY。
 */
export function upsertZeroResultEntries(
  entries: SearchZeroResultEntry[],
  query: string,
  now: number,
  maxEntries = SEARCH_ZERO_RESULTS_MAX_ENTRIES
): SearchZeroResultEntry[] {
  const normalized = normalizeZeroResultQuery(query);
  if (!normalized || maxEntries < 1) {
    return sortZeroResultEntries(entries).slice(0, Math.max(0, maxEntries));
  }

  const byQuery = new Map<string, SearchZeroResultEntry>();
  for (const entry of entries) {
    const key = normalizeZeroResultQuery(entry.query);
    if (!key) continue;
    const prev = byQuery.get(key);
    if (!prev || entry.count > prev.count || entry.lastAt > prev.lastAt) {
      byQuery.set(key, {
        query: key,
        count: Math.max(1, Math.floor(entry.count) || 1),
        lastAt: entry.lastAt,
      });
    }
  }

  const existing = byQuery.get(normalized);
  byQuery.set(normalized, {
    query: normalized,
    count: (existing?.count || 0) + 1,
    lastAt: now,
  });

  return sortZeroResultEntries(Array.from(byQuery.values())).slice(
    0,
    maxEntries
  );
}

function entriesFromCountLastMaps(
  counts: Record<string, string | number>,
  lasts: Record<string, string | number>
): SearchZeroResultEntry[] {
  const out: SearchZeroResultEntry[] = [];
  for (const [rawQuery, rawCount] of Object.entries(counts)) {
    const query = normalizeZeroResultQuery(rawQuery);
    if (!query) continue;
    const count = Math.floor(Number(rawCount));
    if (!Number.isFinite(count) || count < 1) continue;
    const lastAt = Math.floor(Number(lasts[rawQuery] ?? lasts[query] ?? 0));
    if (!Number.isFinite(lastAt) || lastAt <= 0) continue;
    out.push({ query, count, lastAt });
  }
  return sortZeroResultEntries(out);
}

function stringifyHash(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any
): Record<string, string | number> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue;
    out[k] = v as string | number;
  }
  return out;
}

async function hgetallBoth(
  client: HashClient,
  kind: 'redis' | 'upstash'
): Promise<{
  counts: Record<string, string | number>;
  lasts: Record<string, string | number>;
}> {
  if (kind === 'upstash') {
    const [counts, lasts] = await Promise.all([
      client.hgetall(COUNT_HASH_KEY),
      client.hgetall(LAST_HASH_KEY),
    ]);
    return {
      counts: stringifyHash(counts),
      lasts: stringifyHash(lasts),
    };
  }
  const [counts, lasts] = await Promise.all([
    client.hGetAll(COUNT_HASH_KEY),
    client.hGetAll(LAST_HASH_KEY),
  ]);
  return {
    counts: stringifyHash(counts),
    lasts: stringifyHash(lasts),
  };
}

async function hdelFields(
  client: HashClient,
  kind: 'redis' | 'upstash',
  fields: string[]
): Promise<void> {
  if (fields.length === 0) return;
  if (kind === 'upstash') {
    await Promise.all([
      client.hdel(COUNT_HASH_KEY, ...fields),
      client.hdel(LAST_HASH_KEY, ...fields),
    ]);
    return;
  }
  await Promise.all([
    client.hDel(COUNT_HASH_KEY, fields),
    client.hDel(LAST_HASH_KEY, fields),
  ]);
}

async function hashFieldCount(
  client: HashClient,
  kind: 'redis' | 'upstash'
): Promise<number> {
  const raw =
    kind === 'upstash'
      ? await client.hlen(COUNT_HASH_KEY)
      : await client.hLen(COUNT_HASH_KEY);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 超過上限時刪掉次數最低的欄位。
 * 先用 HLEN（O(1)）擋；未超標不 HGETALL。
 */
async function pruneIfNeeded(
  client: HashClient,
  kind: 'redis' | 'upstash'
): Promise<void> {
  const len = await hashFieldCount(client, kind);
  if (len <= SEARCH_ZERO_RESULTS_MAX_ENTRIES) return;

  const { counts, lasts } = await hgetallBoth(client, kind);
  const entries = entriesFromCountLastMaps(counts, lasts);
  if (entries.length <= SEARCH_ZERO_RESULTS_MAX_ENTRIES) return;

  const keep = new Set(
    entries.slice(0, SEARCH_ZERO_RESULTS_MAX_ENTRIES).map((e) => e.query)
  );
  // hash 欄位可能是正規化前的 key；對照 counts 的實際 field 名刪
  const dropFields = Object.keys(counts).filter((field) => {
    const q = normalizeZeroResultQuery(field);
    return !q || !keep.has(q);
  });
  await hdelFields(client, kind, dropFields);
}

function listFromMemory(): SearchZeroResultEntry[] {
  const entries: SearchZeroResultEntry[] = [];
  for (const [query, value] of memoryStore()) {
    entries.push({
      query,
      count: value.count,
      lastAt: value.lastAt,
    });
  }
  return sortZeroResultEntries(entries).slice(
    0,
    SEARCH_ZERO_RESULTS_MAX_ENTRIES
  );
}

function recordInMemory(query: string, now: number): void {
  const store = memoryStore();
  const prev = store.get(query);
  store.set(query, {
    count: (prev?.count || 0) + 1,
    lastAt: now,
  });
  if (store.size <= SEARCH_ZERO_RESULTS_MAX_ENTRIES) return;

  const ranked = sortZeroResultEntries(
    Array.from(store.entries()).map(([q, v]) => ({
      query: q,
      count: v.count,
      lastAt: v.lastAt,
    }))
  );
  const keep = new Set(
    ranked.slice(0, SEARCH_ZERO_RESULTS_MAX_ENTRIES).map((e) => e.query)
  );
  for (const key of Array.from(store.keys())) {
    if (!keep.has(key)) store.delete(key);
  }
}

/** 搜尋 API 零結果時呼叫；失敗不影響搜尋回應 */
export async function recordSearchZeroResult(
  rawQuery: string,
  now = Date.now()
): Promise<void> {
  const query = normalizeZeroResultQuery(rawQuery);
  if (!query) return;

  try {
    const borrowed = getBorrowedClient();
    if (!borrowed) {
      recordInMemory(query, now);
      return;
    }

    const client = borrowed.client as HashClient;
    const { kind } = borrowed;
    if (kind === 'upstash') {
      await Promise.all([
        client.hincrby(COUNT_HASH_KEY, query, 1),
        client.hset(LAST_HASH_KEY, { [query]: now }),
      ]);
    } else {
      await Promise.all([
        client.hIncrBy(COUNT_HASH_KEY, query, 1),
        client.hSet(LAST_HASH_KEY, query, String(now)),
      ]);
    }
    // HLEN 未超標則不 HGETALL；裁切失敗不影響已寫入的增量
    try {
      await pruneIfNeeded(client, kind);
    } catch (error) {
      logger.warn('裁切零結果 hash 失敗：', error);
    }
  } catch (error) {
    logger.warn('記錄零結果查詢失敗，改用記憶體：', error);
    try {
      recordInMemory(query, now);
    } catch {
      /* 記憶體後備也失敗就放棄 */
    }
  }
}

export async function listSearchZeroResults(): Promise<
  SearchZeroResultEntry[]
> {
  try {
    const borrowed = getBorrowedClient();
    if (!borrowed) {
      return listFromMemory();
    }
    const { counts, lasts } = await hgetallBoth(borrowed.client, borrowed.kind);
    return entriesFromCountLastMaps(counts, lasts).slice(
      0,
      SEARCH_ZERO_RESULTS_MAX_ENTRIES
    );
  } catch (error) {
    logger.warn('列出零結果查詢失敗，改用記憶體：', error);
    return listFromMemory();
  }
}

/** 測試用：清空進程內記憶體後備 */
export function resetSearchZeroResultsMemoryForTests(): void {
  globalZeroResults.__berserkerSearchZeroResultsMap = new Map();
}
