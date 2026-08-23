import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import type { PlayRecord } from '@/lib/db.client';

export const runtime = 'nodejs';

interface UserStats {
  username: string;
  role: string;
  totalWatchTime: number;
  totalPlays: number;
  completedShows: number;
  lastActivity: number;
  favoriteSource: string;
}

interface PlayStatsResponse {
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

export async function GET(request: NextRequest) {
  try {
    if (!(await requireAdmin(request))) {
      return NextResponse.json({ error: '權限不足' }, { status: 401 });
    }

    const config = await getConfig();

    // 取得所有使用者（去重：owner 可能同時出現在 env 和 UserConfig 中）
    const ownerUsername = process.env.USERNAME || 'admin';
    const configUsers = config.UserConfig.Users.filter(
      (u) => u.username !== ownerUsername
    );
    const allUsers = [
      { username: ownerUsername, role: 'owner' },
      ...configUsers.map((u) => ({
        username: u.username,
        role: u.role,
      })),
    ];

    // 並行查詢所有使用者的播放記錄
    const allSourceCounts = new Map<string, number>();
    const dailyData = new Map<string, { watchTime: number; plays: number }>();

    const userStatsPromises = allUsers.map(async (user) => {
      try {
        const records: Record<string, PlayRecord> = await db.getAllPlayRecords(
          user.username
        );
        const entries = Object.values(records);

        const totalWatchTime = entries.reduce(
          (sum, r) => sum + (r.play_time || 0),
          0
        );
        const totalPlays = entries.length;
        const completedShows = entries.filter(
          (r) => r.total_episodes > 0 && r.index >= r.total_episodes
        ).length;
        const lastActivity =
          entries.length > 0
            ? Math.max(...entries.map((r) => r.save_time || 0))
            : 0;

        // 最常用片源
        const sourceCounts = new Map<string, number>();
        entries.forEach((r) => {
          const source = r.source_name || '未知';
          sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
          // 累計全域片源統計
          allSourceCounts.set(source, (allSourceCounts.get(source) || 0) + 1);
          // 累計每日統計
          if (r.save_time) {
            const dateKey = new Date(r.save_time).toISOString().split('T')[0];
            const existing = dailyData.get(dateKey) || {
              watchTime: 0,
              plays: 0,
            };
            dailyData.set(dateKey, {
              watchTime: existing.watchTime + (r.play_time || 0),
              plays: existing.plays + 1,
            });
          }
        });
        const sortedSources = Array.from(sourceCounts.entries()).sort(
          (a, b) => b[1] - a[1]
        );
        const favoriteSource = sortedSources[0]?.[0] || '無';

        return {
          username: user.username,
          role: user.role,
          totalWatchTime,
          totalPlays,
          completedShows,
          lastActivity,
          favoriteSource,
        };
      } catch {
        return {
          username: user.username,
          role: user.role,
          totalWatchTime: 0,
          totalPlays: 0,
          completedShows: 0,
          lastActivity: 0,
          favoriteSource: '無',
        };
      }
    });

    const users = await Promise.all(userStatsPromises);

    // 計算總覽統計
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const totalWatchTime = users.reduce((sum, u) => sum + u.totalWatchTime, 0);
    const totals = {
      totalUsers: users.length,
      totalWatchTime,
      totalPlays: users.reduce((sum, u) => sum + u.totalPlays, 0),
      activeToday: users.filter((u) => u.lastActivity > oneDayAgo).length,
      activeThisWeek: users.filter((u) => u.lastActivity > oneWeekAgo).length,
      avgWatchTimePerUser:
        users.length > 0 ? Math.round(totalWatchTime / users.length) : 0,
    };

    // 最近 7 天每日統計
    const dailyStats: { date: string; watchTime: number; plays: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      const data = dailyData.get(dateKey) || { watchTime: 0, plays: 0 };
      dailyStats.push({
        date: dateKey,
        watchTime: data.watchTime,
        plays: data.plays,
      });
    }

    // 熱門片源 Top 5
    const topSources = Array.from(allSourceCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([source, count]) => ({ source, count }));

    const response: PlayStatsResponse = {
      users,
      totals,
      dailyStats,
      topSources,
    };

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('取得播放統計失敗:', err);
    return NextResponse.json({ error: '取得播放統計失敗' }, { status: 500 });
  }
}
