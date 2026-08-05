/** @jest-environment node */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 結構性測試：讓「某支路由 / helper 呼叫 saveAdminConfig 卻忘記加鎖」
 * 變成 CI 會擋下的錯誤。
 *
 * 管理設定是整份文件式的讀→改→寫。兩輪 withAdminConfigLock 改造之後，
 * 所有顯式寫入入口都必須：
 *   1. 在 withAdminConfigLock 內呼叫 saveAdminConfig
 *   2. 除非是整份覆寫，否則鎖內要 getFreshConfig / getAdminConfig 重讀
 *
 * 路由測試把鎖 mock 成 (fn) => fn()，測不到「忘了加鎖」；這個掃描跟
 * api-auth-coverage.test.ts 同一個形狀，把慣例變成硬性檢查。
 */

const SRC_ROOT = path.join(process.cwd(), 'src');

/** 允許不在 withAdminConfigLock 內的 save（必須寫清楚理由） */
interface UnlockExemption {
  /** 相對 src/ 的路徑，使用 / */
  file: string;
  /**
   * 出現在該 save 呼叫附近的唯一片段，用來在同一檔多處 save 時定位。
   * 比對範圍是呼叫點前後各 ~200 字元。
   */
  near: string;
  reason: string;
}

/**
 * 允許鎖內不重讀的整份覆寫（匯入指定設定 / 回滾到指定快照）。
 * 這類 save 的語意就是「寫入這一份」，重讀反而會破壞語意。
 */
interface FullOverwriteExemption {
  file: string;
  near: string;
  reason: string;
}

/** 無鎖豁免：目前生產碼不應再有「鎖外 saveAdminConfig」。維持空清單並靠測試看守。 */
const SAVE_WITHOUT_LOCK_EXEMPTIONS: UnlockExemption[] = [];

const FULL_OVERWRITE_EXEMPTIONS: FullOverwriteExemption[] = [
  {
    file: 'app/api/admin/data_migration/import/route.ts',
    near: 'saveAdminConfig(backup.adminConfig)',
    reason: '匯入失敗回滾：整份覆寫成備份快照，語意就是寫入這一份',
  },
  {
    file: 'app/api/admin/data_migration/import/route.ts',
    near: 'saveAdminConfig(importedAdminConfig)',
    reason: '資料匯入：整份覆寫成匯入的 adminConfig，語意就是寫入這一份',
  },
];

const RE_READ_HELPERS = ['getFreshConfig(', 'getAdminConfig('];

function listProductionTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '__snapshots__' ||
        entry.name === '.next'
      ) {
        return [];
      }
      return listProductionTsFiles(full);
    }
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) {
      return [];
    }
    if (
      entry.name.endsWith('.test.ts') ||
      entry.name.endsWith('.test.tsx') ||
      entry.name.endsWith('.spec.ts') ||
      entry.name.endsWith('.spec.tsx')
    ) {
      return [];
    }
    return [full];
  });
}

function relativeSrc(file: string): string {
  return path.relative(SRC_ROOT, file).split(path.sep).join('/');
}

/** 統一換行：Windows checkout 是 CRLF，字元偏移會被 \r 弄亂 */
function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/**
 * 從 openIndex 指向的 openChar 起，找匹配的 closeChar。
 * 會跳過字串與註解，避免字串裡的括號干擾。
 */
function findMatching(
  source: string,
  openIndex: number,
  openChar: string,
  closeChar: string
): number {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openIndex; i < source.length; i++) {
    const c = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '"') inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (c === '\\') {
        i++;
        continue;
      }
      if (c === '`') inTemplate = false;
      continue;
    }

    if (c === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === '`') {
      inTemplate = true;
      continue;
    }

    if (c === openChar) {
      depth++;
      continue;
    }
    if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function skipWsAndComments(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      i += 2;
      while (
        i < source.length &&
        !(source[i] === '*' && source[i + 1] === '/')
      ) {
        i++;
      }
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

/**
 * 從識別子起點（withAdminConfigLock / saveAdminConfig 的 'w' / 's'）
 * 找出呼叫括號的 [open, close] 範圍。
 */
function findCallParenRange(
  source: string,
  nameStart: number,
  name: string
): { open: number; close: number } | null {
  let i = nameStart + name.length;
  i = skipWsAndComments(source, i);

  // 可選泛型參數 withAdminConfigLock<T>(
  if (source[i] === '<') {
    const genericClose = findMatching(source, i, '<', '>');
    if (genericClose < 0) return null;
    i = skipWsAndComments(source, genericClose + 1);
  }

  if (source[i] !== '(') return null;
  const open = i;
  const close = findMatching(source, open, '(', ')');
  if (close < 0) return null;
  return { open, close };
}

interface SaveSite {
  file: string;
  /** 0-based character offset of '.saveAdminConfig' */
  index: number;
  line: number;
  /** 呼叫點前後各約 200 字元，用來比對 near */
  window: string;
  /** saveAdminConfig(...) 的括號範圍 */
  callRange: { open: number; close: number };
}

interface LockRange {
  open: number;
  close: number;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function collectLockRanges(source: string): LockRange[] {
  const ranges: LockRange[] = [];
  const needle = 'withAdminConfigLock';
  let from = 0;
  while (from < source.length) {
    const idx = source.indexOf(needle, from);
    if (idx === -1) break;

    // 方法定義（db.ts）是 `async withAdminConfigLock` 本體，不是呼叫；
    // 呼叫端一律是 `.withAdminConfigLock` 或 `db.withAdminConfigLock`。
    // 若前面不是「識別子延續字元」，可能是定義——仍嘗試解析括號；
    // 定義的 fn 參數括號範圍內不會有 saveAdminConfig 呼叫，無害。
    const range = findCallParenRange(source, idx, needle);
    if (range) {
      ranges.push(range);
    }
    from = idx + needle.length;
  }
  return ranges;
}

function collectSaveSites(file: string, source: string): SaveSite[] {
  const sites: SaveSite[] = [];
  // 只抓方法呼叫 `.saveAdminConfig(`，排除 `async saveAdminConfig(` 定義
  const needle = '.saveAdminConfig';
  let from = 0;
  while (from < source.length) {
    const idx = source.indexOf(needle, from);
    if (idx === -1) break;

    const nameStart = idx + 1; // 's' of saveAdminConfig
    const range = findCallParenRange(source, nameStart, 'saveAdminConfig');
    if (range) {
      const windowStart = Math.max(0, idx - 200);
      const windowEnd = Math.min(source.length, range.close + 80);
      sites.push({
        file,
        index: idx,
        line: lineOf(source, idx),
        window: source.slice(windowStart, windowEnd),
        callRange: range,
      });
    }
    from = idx + needle.length;
  }
  return sites;
}

function isInsideLock(site: SaveSite, locks: LockRange[]): boolean {
  return locks.some(
    (lock) => site.index > lock.open && site.index < lock.close
  );
}

function enclosingLock(
  site: SaveSite,
  locks: LockRange[]
): LockRange | undefined {
  // 取最小包圍範圍（最內層鎖）
  const enclosing = locks.filter(
    (lock) => site.index > lock.open && site.index < lock.close
  );
  if (enclosing.length === 0) return undefined;
  return enclosing.reduce((a, b) =>
    b.close - b.open < a.close - a.open ? b : a
  );
}

function matchExemption(
  site: SaveSite,
  list: Array<{ file: string; near: string; reason: string }>
): { file: string; near: string; reason: string } | undefined {
  return list.find(
    (entry) => entry.file === site.file && site.window.includes(entry.near)
  );
}

function hasReReadInLock(
  source: string,
  lock: LockRange,
  site: SaveSite
): boolean {
  // 重讀必須出現在同一把鎖內、且在 save 之前
  const region = source.slice(lock.open, site.index);
  return RE_READ_HELPERS.some((helper) => region.includes(helper));
}

const productionFiles = listProductionTsFiles(SRC_ROOT).map((abs) => ({
  file: relativeSrc(abs),
  source: readSource(abs),
}));

const allSaveSites: SaveSite[] = productionFiles.flatMap(({ file, source }) =>
  collectSaveSites(file, source)
);

describe('saveAdminConfig 必須在 withAdminConfigLock 內', () => {
  it('掃到的 save 數量合理（避免掃描失效後空跑而假綠）', () => {
    // 目前約 12 處生產呼叫；若低於 8 表示掃描路徑或 pattern 壞了
    expect(allSaveSites.length).toBeGreaterThanOrEqual(8);
  });

  it('每個 saveAdminConfig 呼叫都在鎖內，或已列入有理由的豁免', () => {
    const unlocked: Array<{ file: string; line: number; detail: string }> = [];

    for (const site of allSaveSites) {
      const source = productionFiles.find((f) => f.file === site.file)!.source;
      const locks = collectLockRanges(source);
      if (isInsideLock(site, locks)) continue;

      const exemption = matchExemption(site, SAVE_WITHOUT_LOCK_EXEMPTIONS);
      if (exemption) {
        expect(exemption.reason.length).toBeGreaterThan(10);
        continue;
      }

      unlocked.push({
        file: site.file,
        line: site.line,
        detail: 'saveAdminConfig 不在 withAdminConfigLock 內，也未列入豁免',
      });
    }

    expect(unlocked).toEqual([]);
  });

  it('鎖內的讀改寫會重讀設定；整份覆寫必須列入允許清單', () => {
    const missingReRead: Array<{ file: string; line: number; detail: string }> =
      [];

    for (const site of allSaveSites) {
      const source = productionFiles.find((f) => f.file === site.file)!.source;
      const locks = collectLockRanges(source);
      const lock = enclosingLock(site, locks);
      if (!lock) {
        // 無鎖的由上一則處理（豁免或失敗）
        continue;
      }

      if (hasReReadInLock(source, lock, site)) continue;

      const exemption = matchExemption(site, FULL_OVERWRITE_EXEMPTIONS);
      if (exemption) {
        expect(exemption.reason.length).toBeGreaterThan(10);
        continue;
      }

      missingReRead.push({
        file: site.file,
        line: site.line,
        detail:
          '鎖內 saveAdminConfig 前未呼叫 getFreshConfig/getAdminConfig，' +
          '且未列入整份覆寫允許清單',
      });
    }

    expect(missingReRead).toEqual([]);
  });

  it('無鎖豁免清單沒有指向已不存在的呼叫點', () => {
    const stale = SAVE_WITHOUT_LOCK_EXEMPTIONS.filter((entry) => {
      return !allSaveSites.some(
        (site) => site.file === entry.file && site.window.includes(entry.near)
      );
    }).map((entry) => `${entry.file} :: ${entry.near}`);

    expect(stale).toEqual([]);
  });

  it('整份覆寫允許清單沒有指向已不存在的呼叫點', () => {
    const stale = FULL_OVERWRITE_EXEMPTIONS.filter((entry) => {
      return !allSaveSites.some(
        (site) => site.file === entry.file && site.window.includes(entry.near)
      );
    }).map((entry) => `${entry.file} :: ${entry.near}`);

    expect(stale).toEqual([]);
  });

  it('豁免理由都有實質說明（避免空字串充數）', () => {
    for (const entry of [
      ...SAVE_WITHOUT_LOCK_EXEMPTIONS,
      ...FULL_OVERWRITE_EXEMPTIONS,
    ]) {
      expect(entry.reason.trim().length).toBeGreaterThan(10);
    }
  });
});
