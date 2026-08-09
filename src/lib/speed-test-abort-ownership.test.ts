/** @jest-environment node */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 結構性測試：abortActiveSpeedTests 的呼叫所有權。
 *
 * 背景：fetchSourcesData 曾有 `speedTest !== false` 預設開的路徑，
 * 會呼叫 abortActiveSpeedTests() 掐掉進行中的 preferBestSource，
 * 讓 1080p 底線靜默失效。該路徑已刪。
 *
 * 只鎖 usePlaybackSourceSearch.ts 檔內不夠：abort 從 hook 回傳，
 * 任何元件都能呼叫。形狀對齊 speed-test-episode-url-coverage：
 * 掃全 src → 禁止 abortActiveSpeedTests( → 例外寫進帶 reason 的豁免表。
 *
 * 檔內細部：preferBestSource 唯一呼叫、fetchSourcesData 不得再開測速，
 * 仍由本檔後段斷言管。
 */

const SRC_ROOT = path.join(process.cwd(), 'src');
const HOOK_REL = 'hooks/usePlaybackSourceSearch.ts';
const HOOK_PATH = path.join(SRC_ROOT, ...HOOK_REL.split('/'));

/** 呼叫點（不含 `const abortActiveSpeedTests =` 定義） */
const ABORT_CALL_RE = /\babortActiveSpeedTests\s*\(/;

interface AbortCallExemption {
  reason: string;
}

/**
 * 允許出現 abortActiveSpeedTests( 的檔案。
 * 新增豁免＝公開寫下「為什麼可以中止測速」。
 *
 * 路徑相對 src/，正斜線。
 */
const ABORT_CALL_EXEMPTIONS: Record<string, AbortCallExemption> = {
  [HOOK_REL]: {
    reason:
      '定義 abortActiveSpeedTests，且 preferBestSource 內有唯一呼叫以開啟新一輪測速；' +
      '檔內細部位置由本檔其他斷言管',
  },
  'app/play/page.tsx': {
    reason: '卸載清理：離開播放頁必須中止在途測速，避免卸載後仍寫入 state',
  },
};

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__snapshots__') {
        return [];
      }
      return listSourceFiles(full);
    }
    if (!entry.isFile()) return [];
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.(ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

function relativeSrc(file: string): string {
  return path.relative(SRC_ROOT, file).split(path.sep).join('/');
}

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/** 去掉註解，避免 doc 誤報 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function hasAbortCall(source: string): boolean {
  return ABORT_CALL_RE.test(stripComments(source));
}

const allFiles = listSourceFiles(SRC_ROOT);
const filesWithAbortCall = allFiles
  .map((file) => ({
    rel: relativeSrc(file),
    source: readSource(file),
  }))
  .filter((entry) => hasAbortCall(entry.source));

describe('測速 abort 所有權：全 src 掃描', () => {
  it('掃到的 abort 呼叫端數量合理（避免掃描失效後空跑）', () => {
    // 目前應為 hook + play/page 兩個
    expect(filesWithAbortCall.length).toBeGreaterThanOrEqual(2);
  });

  it('豁免表每一條都有足夠理由，且路徑仍存在', () => {
    for (const [rel, exemption] of Object.entries(ABORT_CALL_EXEMPTIONS)) {
      expect(exemption.reason.length).toBeGreaterThan(15);
      const full = path.join(SRC_ROOT, ...rel.split('/'));
      expect(fs.existsSync(full)).toBe(true);
    }
  });

  it('豁免表沒有指向已不存在的呼叫點', () => {
    const stale = Object.keys(ABORT_CALL_EXEMPTIONS).filter((rel) => {
      const full = path.join(SRC_ROOT, ...rel.split('/'));
      if (!fs.existsSync(full)) return true;
      return !hasAbortCall(readSource(full));
    });
    expect(stale).toEqual([]);
  });

  it.each(filesWithAbortCall.map(({ rel }) => rel))(
    '%s 若呼叫 abortActiveSpeedTests( 必須已列入豁免並說明理由',
    (rel) => {
      const exemption = ABORT_CALL_EXEMPTIONS[rel];
      expect(exemption).toBeDefined();
      expect(exemption!.reason.length).toBeGreaterThan(15);
    }
  );

  it('非豁免檔案不得出現 abortActiveSpeedTests(', () => {
    const violations = allFiles
      .map((file) => relativeSrc(file))
      .filter((rel) => !ABORT_CALL_EXEMPTIONS[rel])
      .filter((rel) => {
        const full = path.join(SRC_ROOT, ...rel.split('/'));
        return hasAbortCall(readSource(full));
      });
    expect(violations).toEqual([]);
  });
});

describe('測速 abort 所有權：usePlaybackSourceSearch 檔內', () => {
  it('abortActiveSpeedTests( 的呼叫點只有一個，且落在 preferBestSource 內', () => {
    const source = stripComments(readSource(HOOK_PATH));

    const callRe = /\babortActiveSpeedTests\s*\(/g;
    const calls: number[] = [];
    let match: RegExpExecArray | null;
    while ((match = callRe.exec(source)) !== null) {
      calls.push(match.index);
    }

    expect(calls).toHaveLength(1);

    const callIndex = calls[0]!;
    const preferStart = source.lastIndexOf(
      'const preferBestSource = async',
      callIndex
    );
    expect(preferStart).toBeGreaterThanOrEqual(0);

    const afterPrefer = source.slice(preferStart);
    const endMatch = afterPrefer.match(
      /\n {2}const fetchSourcesData\b|\n {2}return \{/
    );
    expect(endMatch).not.toBeNull();
    const preferEnd = preferStart + (endMatch!.index ?? 0);

    expect(callIndex).toBeGreaterThan(preferStart);
    expect(callIndex).toBeLessThan(preferEnd);
  });

  it('fetchSourcesData 內不得再出現 abortActiveSpeedTests 或 speedTest 選項', () => {
    const source = stripComments(readSource(HOOK_PATH));
    const fetchStart = source.indexOf('const fetchSourcesData = async');
    expect(fetchStart).toBeGreaterThanOrEqual(0);

    const afterFetch = source.slice(fetchStart);
    const endMatch = afterFetch.match(/\n {2}return \{/);
    expect(endMatch).not.toBeNull();
    const fetchBody = afterFetch.slice(0, endMatch!.index);

    expect(fetchBody).not.toMatch(/\babortActiveSpeedTests\s*\(/);
    expect(fetchBody).not.toMatch(/\bspeedTest\b/);
  });
});
