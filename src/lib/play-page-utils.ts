export type VideoTestResult = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
};

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
