export type VideoTestResult = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
};

export function isMobileUserAgent(userAgent: string): boolean {
  return /Mobi|Android|iPhone|iPod|iPad|webOS|BlackBerry|IEMobile/i.test(
    userAgent
  );
}

export function getVodHlsBufferConfig(isMobile: boolean): {
  maxBufferLength: number;
  backBufferLength: number;
  maxBufferSize: number;
} {
  return isMobile
    ? {
        maxBufferLength: 15,
        backBufferLength: 10,
        maxBufferSize: 20 * 1000 * 1000,
      }
    : {
        maxBufferLength: 30,
        backBufferLength: 15,
        maxBufferSize: 40 * 1000 * 1000,
      };
}

export function getLiveHlsBufferConfig(isMobile: boolean): {
  maxBufferLength: number;
  backBufferLength: number;
  maxBufferSize: number;
} {
  return isMobile
    ? {
        maxBufferLength: 12,
        backBufferLength: 8,
        maxBufferSize: 20 * 1000 * 1000,
      }
    : {
        maxBufferLength: 20,
        backBufferLength: 15,
        maxBufferSize: 40 * 1000 * 1000,
      };
}

/**
 * 畫質／速度測速要打哪一集的 URL。
 *
 * CMS `vod_play_url` 原樣收進 episodes，index 0 常是預告／花絮／重複條目
 * （見 downstream.parseVodPlayUrl，不過濾）。有第二筆就用 [1]，單集才退回 [0]。
 *
 * 首播優選測速與背景列表測速必須共用此函式，否則 1080p 閘門與換源標籤
 * 可能量到不同 URL、合法地互相矛盾。
 *
 * 不適用：source-validation 等「能不能播」探針（仍可用 [0]）。
 */
export function pickSpeedTestEpisodeUrl(
  episodes: string[] | undefined | null
): string | null {
  if (!episodes || episodes.length === 0) return null;
  const preferred = episodes.length > 1 ? episodes[1] : episodes[0];
  const url = typeof preferred === 'string' ? preferred.trim() : '';
  return url || null;
}

/** 1080p 及以上：換源列表優先顯示的畫質 */
export function isPreferredDisplayQuality(
  quality: string | undefined | null
): boolean {
  if (!quality) return false;
  const q = quality.trim();
  return q === '4K' || q === '2K' || q === '1080p' || q === '1080P';
}

/**
 * 明確低於 1080p 的畫質。有任一 1080p+ 可用源時，列表應隱藏這些。
 * 「未知」不視為低畫質（測速未完成／無法解析時保守保留）。
 */
export function isBelowPreferredDisplayQuality(
  quality: string | undefined | null
): boolean {
  if (!quality) return false;
  const q = quality.trim();
  return (
    q === '720p' ||
    q === '480p' ||
    q === '360p' ||
    q === '240p' ||
    q === 'SD' ||
    q === '錯誤'
  );
}

export type SourceQualityInfo = {
  quality: string;
  hasError?: boolean;
};

/**
 * 換源列表畫質過濾：
 * - 若存在至少一個「測過且為 1080p+」的源 → 隱藏 720p／480p／SD 等
 * - 目前正在播的源永遠保留
 * - 尚未測速、連線失敗、畫質未知 → 保留（避免列表閃爍或以為沒源）
 * - 若完全沒有 1080p+ → 全部保留
 */
export function filterSourcesPreferHighQuality<
  T extends { source?: string | number; id?: string | number },
>(
  sources: T[],
  options: {
    currentSource?: string | number | null;
    currentId?: string | number | null;
    getInfo: (sourceKey: string) => SourceQualityInfo | undefined;
  }
): T[] {
  const keyOf = (s: T) => `${s.source}-${s.id}`;
  const isCurrent = (s: T) =>
    s.source?.toString() === options.currentSource?.toString() &&
    s.id?.toString() === options.currentId?.toString();

  const hasPreferred = sources.some((s) => {
    const info = options.getInfo(keyOf(s));
    return !!info && !info.hasError && isPreferredDisplayQuality(info.quality);
  });

  if (!hasPreferred) return sources;

  return sources.filter((s) => {
    if (isCurrent(s)) return true;
    const info = options.getInfo(keyOf(s));
    if (!info) return true;
    if (info.hasError) return true;
    if (isBelowPreferredDisplayQuality(info.quality)) return false;
    return true;
  });
}

const UNKNOWN_SPEED_LABELS = new Set(['未知', '測量中...']);

export function getStableTitle(
  ...titles: Array<string | undefined | null>
): string {
  return (
    titles
      .find((title) => {
        const value = title?.trim();
        return (
          value &&
          value !== 'undefined' &&
          value !== 'null' &&
          value !== '影片標題'
        );
      })
      ?.trim() || ''
  );
}

export function formatPlayerTime(seconds: number): string {
  if (seconds === 0) return '00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (hours === 0) {
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function parseLoadSpeedKBps(loadSpeed: string): number {
  if (!loadSpeed || UNKNOWN_SPEED_LABELS.has(loadSpeed)) return 0;

  const match = loadSpeed.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2];
  return unit === 'MB/s' ? value * 1024 : value;
}

/** 標題分組容差：與 preferBestSource 既有行為一致（max - 80） */
export const TITLE_MATCH_SAFE_MARGIN = 80;

/**
 * 標題安全組：分數距最高分不超過 margin 的候選。
 * 畫質／速度閘門必須在此之後，避免 1080p 但播錯片。
 */
export function filterTitleSafeCandidates<T extends { titleScore: number }>(
  candidates: T[],
  margin = TITLE_MATCH_SAFE_MARGIN
): T[] {
  if (candidates.length === 0) return [];
  const maxTitleScore = Math.max(...candidates.map((c) => c.titleScore));
  return candidates.filter((c) => c.titleScore >= maxTitleScore - margin);
}

export type SpeedTestedCandidate<T = unknown> = {
  source: T;
  testResult: VideoTestResult;
  titleScore: number;
};

/**
 * 全部測速完成後的首播選擇（無「命中即起播」時）。
 * 順序：標題安全組 → 組內若有 1080p+ 只從其中選 → 否則整組退回評分（fellBackWithoutHd）。
 * 「未知」畫質不算 1080p+（與 isPreferredDisplayQuality 一致），可參與退回評分。
 */
export function selectSourceAfterSpeedTests<T>(
  successful: Array<SpeedTestedCandidate<T>>
): { source: T; fellBackWithoutHd: boolean } | null {
  if (successful.length === 0) return null;

  const titleSafe = filterTitleSafeCandidates(successful);
  const pool = titleSafe.length > 0 ? titleSafe : successful;

  const hdPool = pool.filter((c) =>
    isPreferredDisplayQuality(c.testResult.quality)
  );
  const usePool = hdPool.length > 0 ? hdPool : pool;
  const fellBackWithoutHd = hdPool.length === 0;

  const validSpeeds = usePool
    .map((result) => parseLoadSpeedKBps(result.testResult.loadSpeed))
    .filter((speed) => speed > 0);
  const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;

  const validPings = usePool
    .map((result) => result.testResult.pingTime)
    .filter((ping) => ping > 0);
  const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
  const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

  const ranked = usePool
    .map((result) => ({
      ...result,
      sourceScore: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }))
    .sort((a, b) => b.sourceScore - a.sourceScore);

  return {
    source: ranked[0].source,
    fellBackWithoutHd,
  };
}

export function calculateSourceScore(
  testResult: VideoTestResult,
  _maxSpeed: number,
  _minPing: number,
  _maxPing: number
): number {
  let score = 0;

  const qualityScore = (() => {
    switch (testResult.quality) {
      case '4K':
        return 100;
      case '2K':
        return 85;
      case '1080p':
        return 75;
      case '720p':
        return 60;
      case '480p':
        return 40;
      case 'SD':
        return 20;
      default:
        return 0;
    }
  })();
  score += qualityScore * 0.4;

  const speedKBps = parseLoadSpeedKBps(testResult.loadSpeed);

  const speedScore = (() => {
    if (UNKNOWN_SPEED_LABELS.has(testResult.loadSpeed)) return 30;
    if (speedKBps >= 5 * 1024) return 100;
    if (speedKBps >= 3 * 1024) return 95;
    if (speedKBps >= 2 * 1024) return 90;
    if (speedKBps >= 1 * 1024) return 80;
    if (speedKBps >= 500) return 65;
    if (speedKBps >= 200) return 40;
    if (speedKBps > 0) return 20;
    return 10;
  })();
  score += speedScore * 0.4;

  const pingScore = (() => {
    const ping = testResult.pingTime;
    if (ping <= 0) return 10;
    if (ping < 50) return 100;
    if (ping < 100) return 95;
    if (ping < 200) return 85;
    if (ping < 400) return 70;
    if (ping < 800) return 50;
    if (ping < 1500) return 30;
    return 10;
  })();
  score += pingScore * 0.2;

  const isHighQuality = ['1080p', '2K', '4K'].includes(testResult.quality);
  if (isHighQuality && speedKBps >= 500) {
    score += 50;
  }

  return Math.round(score * 100) / 100;
}
