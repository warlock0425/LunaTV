'use client';

import { useCallback, useEffect, useState } from 'react';

import { formatWatchTime } from '@/lib/watch-stats';

import { buttonStyles } from './buttonStyles';

interface UserStats {
  username: string;
  role: string;
  totalWatchTime: number;
  totalPlays: number;
  completedShows: number;
  lastActivity: number;
  favoriteSource: string;
}

interface PlayStatsData {
  users: UserStats[];
  totals: {
    totalUsers: number;
    totalWatchTime: number;
    totalPlays: number;
    activeToday: number;
    activeThisWeek: number;
    avgWatchTimePerUser: number;
  };
  dailyStats: { date: string; watchTime: number; plays: number }[];
  topSources: { source: string; count: number }[];
}

export function PlayStatsPanel() {
  const [stats, setStats] = useState<PlayStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/play-stats');
      if (!response.ok) {
        throw new Error('取得統計資料失敗');
      }
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得統計資料失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 掛載時抓取資料：setState 皆發生於 await 之後，規則對具名函式為保守誤判
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStats();
  }, [fetchStats]);

  const formatLastActivity = (timestamp: number) => {
    if (!timestamp) return '從未';
    // 相對時間為顯示用途，讀取當下時間屬預期行為
    // eslint-disable-next-line react-hooks/purity
    const diff = Date.now() - timestamp;
    if (diff < 60 * 1000) return '剛剛';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分鐘前`;
    if (diff < 24 * 60 * 60 * 1000)
      return `${Math.floor(diff / 3600000)} 小時前`;
    if (diff < 7 * 24 * 60 * 60 * 1000)
      return `${Math.floor(diff / 86400000)} 天前`;
    return new Date(timestamp).toLocaleDateString('zh-TW');
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <div className='w-8 h-8 border-[3px] border-accent border-t-transparent rounded-full animate-spin' />
      </div>
    );
  }

  if (error) {
    return (
      <div className='text-center py-8'>
        <p className='text-red-500 mb-4'>{error}</p>
        <button onClick={fetchStats} className={buttonStyles.primary}>
          重新載入
        </button>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className='space-y-6'>
      {/* 總覽卡片 */}
      <div className='grid grid-cols-2 sm:grid-cols-5 gap-3'>
        <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
          <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-1'>
            總使用者數
          </div>
          <div className='text-2xl font-bold text-zinc-900 dark:text-white'>
            {stats.totals.totalUsers}
          </div>
        </div>
        <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
          <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-1'>
            總觀看時長
          </div>
          <div className='text-2xl font-bold text-zinc-900 dark:text-white'>
            {formatWatchTime(stats.totals.totalWatchTime)}
          </div>
        </div>
        <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
          <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-1'>
            總播放次數
          </div>
          <div className='text-2xl font-bold text-zinc-900 dark:text-white'>
            {stats.totals.totalPlays}
          </div>
        </div>
        <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
          <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-1'>
            今日活躍
          </div>
          <div className='text-2xl font-bold text-accent'>
            {stats.totals.activeToday}
          </div>
        </div>
        <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
          <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-1'>
            本週活躍
          </div>
          <div className='text-2xl font-bold text-accent'>
            {stats.totals.activeThisWeek}
          </div>
        </div>
      </div>

      {/* 7 天觀看趨勢 + 熱門片源 */}
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-4'>
        {/* 7 天觀看趨勢 */}
        {stats.dailyStats.some((d) => d.watchTime > 0) && (
          <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
            <div className='text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3'>
              最近 7 天觀看趨勢
            </div>
            <div className='flex items-end gap-2 h-32'>
              {stats.dailyStats.map((day, i) => {
                const maxTime = Math.max(
                  ...stats.dailyStats.map((d) => d.watchTime),
                  1
                );
                const height = Math.max((day.watchTime / maxTime) * 100, 2);
                return (
                  <div
                    key={i}
                    className='flex-1 flex flex-col items-center gap-1'
                  >
                    <div className='text-[10px] text-zinc-400'>
                      {day.plays > 0 ? `${day.plays}次` : ''}
                    </div>
                    <div
                      className='w-full bg-accent/80 rounded-t transition-all duration-300'
                      style={{ height: `${height}%` }}
                    />
                    <div className='text-[10px] text-zinc-400'>
                      {day.date.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 熱門片源 */}
        {stats.topSources.length > 0 && (
          <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
            <div className='text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3'>
              熱門片源 Top 5
            </div>
            <div className='space-y-3'>
              {stats.topSources.map((item, i) => (
                <div key={i} className='flex items-center gap-3'>
                  <div className='w-6 text-xs text-zinc-400 font-medium'>
                    {i + 1}
                  </div>
                  <div className='flex-1 text-sm text-zinc-700 dark:text-zinc-300 truncate'>
                    {item.source}
                  </div>
                  <div className='flex-1 bg-zinc-200 dark:bg-zinc-700 rounded-full h-2 overflow-hidden'>
                    <div
                      className='h-full bg-accent/80 rounded-full transition-all duration-300'
                      style={{
                        width: `${
                          (item.count / stats.topSources[0].count) * 100
                        }%`,
                      }}
                    />
                  </div>
                  <div className='w-12 text-xs text-zinc-400 text-right'>
                    {item.count} 次
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 使用者列表 */}
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-zinc-200 dark:border-zinc-700'>
              <th className='text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium'>
                使用者名
              </th>
              <th className='text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium'>
                角色
              </th>
              <th className='text-right py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium'>
                觀看時長
              </th>
              <th className='text-right py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium'>
                播放次數
              </th>
              <th className='text-right py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium'>
                已完成
              </th>
              <th className='text-left py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium'>
                最常用片源
              </th>
              <th className='text-right py-3 px-4 text-zinc-500 dark:text-zinc-400 font-medium'>
                最近上線
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.users
              .sort((a, b) => b.totalWatchTime - a.totalWatchTime)
              .map((user) => (
                <tr
                  key={user.username}
                  className='border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors'
                >
                  <td className='py-3 px-4 font-medium text-zinc-900 dark:text-white'>
                    {user.username}
                  </td>
                  <td className='py-3 px-4'>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        user.role === 'owner'
                          ? 'bg-accent/10 text-accent'
                          : user.role === 'admin'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                      }`}
                    >
                      {user.role === 'owner'
                        ? '站長'
                        : user.role === 'admin'
                          ? '管理員'
                          : '使用者'}
                    </span>
                  </td>
                  <td className='py-3 px-4 text-right text-zinc-700 dark:text-zinc-300'>
                    {formatWatchTime(user.totalWatchTime)}
                  </td>
                  <td className='py-3 px-4 text-right text-zinc-700 dark:text-zinc-300'>
                    {user.totalPlays}
                  </td>
                  <td className='py-3 px-4 text-right text-zinc-700 dark:text-zinc-300'>
                    {user.completedShows}
                  </td>
                  <td className='py-3 px-4 text-zinc-600 dark:text-zinc-400 truncate max-w-[120px]'>
                    {user.favoriteSource}
                  </td>
                  <td className='py-3 px-4 text-right text-zinc-500 dark:text-zinc-400'>
                    {formatLastActivity(user.lastActivity)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
