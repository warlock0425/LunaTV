import type { PlayRecord } from '@/lib/db.client';

export interface WatchStats {
  totalWatchTimeSeconds: number;
  totalShows: number;
  completedShows: number;
  totalEpisodesWatched: number;
  favoriteSource: string;
  dailyWatchTime: { date: string; seconds: number }[];
  topSources: { name: string; count: number }[];
  averageCompletionRate: number;
}

/**
 * 從播放記錄計算觀看統計
 */
export function calculateWatchStats(
  records: Record<string, PlayRecord>
): WatchStats {
  const entries = Object.values(records);

  // 總觀看時長（秒）
  const totalWatchTimeSeconds = entries.reduce(
    (sum, r) => sum + (r.play_time || 0),
    0
  );

  // 總劇數
  const totalShows = entries.length;

  // 已完成的劇（當前集數 >= 總集數）
  const completedShows = entries.filter(
    (r) => r.total_episodes > 0 && r.index >= r.total_episodes
  ).length;

  // 總觀看集數
  const totalEpisodesWatched = entries.reduce(
    (sum, r) => sum + (r.index || 0),
    0
  );

  // 最常用片源
  const sourceCounts = new Map<string, number>();
  entries.forEach((r) => {
    const source = r.source_name || '未知';
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  });
  const sortedSources = Array.from(sourceCounts.entries()).sort(
    (a, b) => b[1] - a[1]
  );
  const favoriteSource = sortedSources[0]?.[0] || '無';

  // 片源統計（前 5 名）
  const topSources = sortedSources
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // 最近 7 天每天觀看時長
  const now = Date.now();
  const dailyWatchTime: { date: string; seconds: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(now - i * 24 * 60 * 60 * 1000);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const dayRecords = entries.filter(
      (r) => r.save_time >= dayStart.getTime() && r.save_time < dayEnd.getTime()
    );
    const daySeconds = dayRecords.reduce(
      (sum, r) => sum + (r.play_time || 0),
      0
    );

    dailyWatchTime.push({
      date: dayStart.toLocaleDateString('zh-TW', {
        month: 'short',
        day: 'numeric',
      }),
      seconds: daySeconds,
    });
  }

  // 平均完成率
  const completionRates = entries
    .filter((r) => r.total_episodes > 0)
    .map((r) => Math.min(r.index / r.total_episodes, 1));
  const averageCompletionRate =
    completionRates.length > 0
      ? completionRates.reduce((sum, r) => sum + r, 0) / completionRates.length
      : 0;

  return {
    totalWatchTimeSeconds,
    totalShows,
    completedShows,
    totalEpisodesWatched,
    favoriteSource,
    dailyWatchTime,
    topSources,
    averageCompletionRate,
  };
}

/**
 * 格式化秒數為人類可讀格式
 */
export function formatWatchTime(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分鐘`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours < 24) return `${hours} 小時 ${minutes} 分鐘`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return `${days} 天 ${remainHours} 小時`;
}
