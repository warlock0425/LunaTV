/** @jest-environment node */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 結構性測試：畫質／速度測速取集必須走 pickSpeedTestEpisodeUrl。
 *
 * 背景：5469ac3 不是把 pick 函式寫錯，而是呼叫端直接 `episodes[0]`。
 * 只對 pure function 做單元測試擋不住那種回歸（注入 B：改呼叫端全綠）。
 *
 * 形狀對齊 api-outbound-rate-limit-coverage：掃會做測速的檔案 →
 * 禁止直接索引 episodes[0]/[1]/length-1 → 例外寫進帶 reason 的豁免表。
 */

const SRC_ROOT = path.join(process.cwd(), 'src');

/** 出現即視為「會做畫質／速度測量」的呼叫端 */
const SPEED_TEST_MARKERS = [
  'getCachedVideoTestResult(',
  'getVideoResolutionFromM3u8(',
];

/**
 * 禁止在測速路徑直接挑集數。
 * 允許：episodes.length、episodes.map、playingIndex 等非字面 0/1/length-1。
 */
const BANNED_EPISODE_INDEX =
  /\bepisodes\s*\[\s*(?:0|1|(?:[^\]]*?\.)?length\s*-\s*1)\s*\]/;

interface SpeedTestEpisodeExemption {
  reason: string;
}

/**
 * 暫時不強制 pickSpeedTestEpisodeUrl 的檔案。
 * 新增豁免＝公開寫下「為什麼可以自己挑集數」。
 *
 * 路徑相對 src/，正斜線。
 */
const SPEED_TEST_EPISODE_EXEMPTIONS: Record<string, SpeedTestEpisodeExemption> =
  {
    'lib/utils.ts': {
      reason:
        'getVideoResolutionFromM3u8 本體只負責對已給的 m3u8 URL 測速，' +
        '不負責從 episodes 陣列取集',
    },
    'lib/play-page-utils.ts': {
      reason:
        'pickSpeedTestEpisodeUrl 定義檔，內部必須出現 episodes[0]/[1] 實作規則',
    },
    'lib/source-validation.ts': {
      reason:
        '片源驗證問「能不能播」不是量品質；[0] 最快且預告能播也算能播。' +
        '本檔用 probeM3u8Playable 而非 getVideoResolutionFromM3u8，' +
        '列在此以免日後改用測速 API 時被誤收編',
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

/** 去掉註解，避免 doc 裡的 episodes[0] 誤報 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function isSpeedTestCaller(source: string): boolean {
  return SPEED_TEST_MARKERS.some((marker) => source.includes(marker));
}

function hasBannedEpisodeIndex(source: string): boolean {
  return BANNED_EPISODE_INDEX.test(stripComments(source));
}

function usesPicker(source: string): boolean {
  return source.includes('pickSpeedTestEpisodeUrl(');
}

const allFiles = listSourceFiles(SRC_ROOT);
const speedTestFiles = allFiles
  .map((file) => ({
    rel: relativeSrc(file),
    source: readSource(file),
  }))
  .filter((entry) => isSpeedTestCaller(entry.source));

describe('畫質／速度測速取集必須走 pickSpeedTestEpisodeUrl', () => {
  it('掃到的測速呼叫端數量合理（避免掃描失效後空跑）', () => {
    // 至少含 usePlaybackSourceSearch + EpisodeSelector + utils 定義檔
    expect(speedTestFiles.length).toBeGreaterThanOrEqual(2);
  });

  it('豁免表每一條都有足夠理由，且路徑仍存在', () => {
    for (const [rel, exemption] of Object.entries(
      SPEED_TEST_EPISODE_EXEMPTIONS
    )) {
      expect(exemption.reason.length).toBeGreaterThan(15);
      const full = path.join(SRC_ROOT, ...rel.split('/'));
      expect(fs.existsSync(full)).toBe(true);
    }
  });

  it.each(speedTestFiles.map(({ rel }) => rel))(
    '%s 使用 pickSpeedTestEpisodeUrl，或已列入豁免並說明理由',
    (rel) => {
      const entry = speedTestFiles.find((candidate) => candidate.rel === rel)!;
      const exemption = SPEED_TEST_EPISODE_EXEMPTIONS[rel];

      if (exemption) {
        expect(exemption.reason.length).toBeGreaterThan(15);
        return;
      }

      expect({
        rel,
        usesPicker: usesPicker(entry.source),
        hasBannedEpisodeIndex: hasBannedEpisodeIndex(entry.source),
      }).toEqual({
        rel,
        usesPicker: true,
        hasBannedEpisodeIndex: false,
      });
    }
  );

  it('usePlaybackSourceSearch 在掃描集合內且不得直接索引 episodes[0]', () => {
    const target = speedTestFiles.find(
      (entry) => entry.rel === 'hooks/usePlaybackSourceSearch.ts'
    );
    expect(target).toBeDefined();
    expect(usesPicker(target!.source)).toBe(true);
    expect(hasBannedEpisodeIndex(target!.source)).toBe(false);
  });
});
