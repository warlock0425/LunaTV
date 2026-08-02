export type VideoTestResult = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
};

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
