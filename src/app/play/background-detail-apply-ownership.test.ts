/** @jest-environment node */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 結構性測試：背景刷新套用 detail 時必須經過 shouldApplyBackgroundDetail。
 *
 * 背景：merge 後還有一道「當前集 URL 變了就不套用」的雙重保險，
 * 守的是播放中換 URL → HLS 重建 → 音畫錯位。SWR 讓這條更常走。
 *
 * 純函式測試擋得住「函式寫錯」，擋不住「呼叫端繞過」。
 * 此處斷言 page.tsx 內：
 *   shouldApplyBackgroundDetail(  次數 ===  return again.detail;  次數
 * 任一處套用點少了守門，數字就對不上。
 */

const PAGE_PATH = path.join(process.cwd(), 'src', 'app', 'play', 'page.tsx');

function readPageSource(): string {
  return fs.readFileSync(PAGE_PATH, 'utf8').replace(/\r\n/g, '\n');
}

/** 去掉註解，避免 doc 誤報 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function countMatches(source: string, pattern: RegExp): number {
  return (source.match(pattern) || []).length;
}

describe('background detail apply ownership（page.tsx）', () => {
  it('存在 page.tsx 且體積合理（避免路徑失效空跑）', () => {
    expect(fs.existsSync(PAGE_PATH)).toBe(true);
    const raw = readPageSource();
    expect(raw.length).toBeGreaterThan(10_000);
  });

  it('shouldApplyBackgroundDetail( 與 return again.detail 次數相等（每處套用都有守門）', () => {
    const body = stripComments(readPageSource());

    // 呼叫（不含 import 行的識別符）
    const guardCalls = countMatches(
      body,
      /\bshouldApplyBackgroundDetail\s*\(/g
    );
    // 背景刷新 setDetail 內真正「套用新 detail」的出口
    const applyReturns = countMatches(body, /\breturn\s+again\.detail\s*;/g);

    expect({
      shouldApplyBackgroundDetailCalls: guardCalls,
      returnAgainDetail: applyReturns,
    }).toEqual({
      shouldApplyBackgroundDetailCalls: applyReturns,
      returnAgainDetail: applyReturns,
    });

    // 目前已知兩處：init SWR 背景刷新 + 換源後背景刷新；不得被拆成 0
    expect(guardCalls).toBeGreaterThanOrEqual(2);
    expect(applyReturns).toBe(guardCalls);
  });

  it('必須從 play-page-helpers 匯入 shouldApplyBackgroundDetail', () => {
    const body = stripComments(readPageSource());
    expect(body).toMatch(
      /shouldApplyBackgroundDetail[\s\S]*from\s+['"]\.\/play-page-helpers['"]|from\s+['"]\.\/play-page-helpers['"][\s\S]*shouldApplyBackgroundDetail/
    );
    // 更穩：import 區塊含該名與 helpers 路徑
    const importBlock = body.match(
      /import\s*\{[^}]*shouldApplyBackgroundDetail[^}]*\}\s*from\s*['"]\.\/play-page-helpers['"]/
    );
    expect(importBlock).not.toBeNull();
  });
});
