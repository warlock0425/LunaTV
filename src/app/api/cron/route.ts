/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { mapWithConcurrency } from '@/lib/concurrency';
import {
  fetchSubscriptionConfigFile,
  getConfig,
  refineConfig,
  setCachedConfig,
} from '@/lib/config';
import { markCronCompleted, markCronStarted } from '@/lib/cron-health';
import { db } from '@/lib/db';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import { refreshLiveChannels } from '@/lib/live';
import { parseStorageKey } from '@/lib/storage-key';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

let activeCronJob: Promise<void> | null = null;
let activeCronStartedAt = '';

const DEFAULT_CRON_MAX_RUNTIME_MS = process.env.VERCEL
  ? 50 * 1000
  : 8 * 60 * 1000;
const LIVE_REFRESH_START_BUDGET_MS = 24 * 1000;

function getCronDeadline() {
  const configuredMs = Number(process.env.CRON_MAX_RUNTIME_MS);
  const maxRuntimeMs =
    Number.isFinite(configuredMs) && configuredMs > 0
      ? configuredMs
      : DEFAULT_CRON_MAX_RUNTIME_MS;

  return Date.now() + maxRuntimeMs;
}

function isCronTimeExhausted(deadline: number) {
  return Date.now() >= deadline;
}

function shouldStopCron(deadline: number, phase: string) {
  if (!isCronTimeExhausted(deadline)) return false;

  console.warn(`Cron job time budget exhausted, stopping before ${phase}`);
  return true;
}

function startCronJob(): Promise<void> {
  if (activeCronJob) return activeCronJob;

  activeCronStartedAt = new Date().toISOString();
  markCronStarted(activeCronStartedAt);
  const job = cronJob().then(
    () => markCronCompleted(),
    (error) => {
      markCronCompleted(error);
      throw error;
    }
  );
  activeCronJob = job.finally(() => {
    activeCronJob = null;
    activeCronStartedAt = '';
  });
  return activeCronJob;
}

export async function GET(request: NextRequest) {
  // CRON_SECRET 可由部署環境提供；Docker 內建排程會使用啟動時產生的 INTERNAL_CRON_SECRET。
  const cronSecret =
    process.env.CRON_SECRET || process.env.INTERNAL_CRON_SECRET;
  if (!cronSecret) {
    console.warn('Cron job: cron secret 未設定，拒絕執行');
    return NextResponse.json(
      { error: 'Cron secret not configured' },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get('authorization');
  const expectedAuth = `Bearer ${cronSecret}`;
  if (!authHeader || authHeader !== expectedAuth) {
    console.warn('Cron job: 未授權的訪問嘗試');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    console.info('Cron job triggered:', new Date().toISOString());

    const waitForCompletion =
      request.nextUrl.searchParams.get('wait') === 'true';

    if (activeCronJob) {
      return NextResponse.json(
        {
          success: true,
          message: 'Cron job already running',
          running: true,
          startedAt: activeCronStartedAt,
          timestamp: new Date().toISOString(),
        },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    if (waitForCompletion) {
      await startCronJob();

      return NextResponse.json(
        {
          success: true,
          message: 'Cron job executed successfully',
          running: false,
          timestamp: new Date().toISOString(),
        },
        {
          headers: {
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    const backgroundJob = startCronJob();
    void backgroundJob.catch((error) => {
      console.error('Cron job failed:', error);
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Cron job accepted',
        running: true,
        startedAt: activeCronStartedAt,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('Cron job failed:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Cron job failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function cronJob() {
  const deadline = getCronDeadline();

  await refreshConfig();
  if (shouldStopCron(deadline, 'record and favorite refresh')) return;

  // 集數刷新對使用者最有感，優先執行，避免在時間預算內被直播源刷新餓死
  // （Vercel 上預算僅 50 秒，直播源一多就輪不到集數刷新）
  await refreshRecordAndFavorites(deadline);
  if (shouldStopCron(deadline, 'live channel refresh')) return;

  await refreshAllLiveChannels(deadline);
}

async function refreshAllLiveChannels(deadline: number) {
  const config = await getConfig();

  const enabledSources = (config.LiveConfig || []).filter(
    (liveInfo) => !liveInfo.disabled
  );
  await mapWithConcurrency(enabledSources, 3, async (liveInfo) => {
    // 單一來源最多會用掉約 10 秒播放清單 + 12 秒 EPG；預留儲存時間，
    // 不在期限尾端再啟動一個注定超時的刷新。
    if (Date.now() + LIVE_REFRESH_START_BUDGET_MS >= deadline) return;
    try {
      const nums = await refreshLiveChannels(liveInfo);
      liveInfo.channelNumber = nums;
    } catch (error) {
      console.error(
        `刷新直播源失敗 [${liveInfo.name || liveInfo.key}]:`,
        error
      );
      liveInfo.channelNumber = 0;
    }
  });

  // 保存配置
  await db.saveAdminConfig(config);
}

async function refreshConfig() {
  let config = await getConfig();
  if (
    config &&
    config.ConfigSubscription &&
    config.ConfigSubscription.URL &&
    config.ConfigSubscription.AutoUpdate
  ) {
    try {
      const decodedContent = await fetchSubscriptionConfigFile(
        config.ConfigSubscription.URL
      );
      config.ConfigFile = decodedContent;
      config.ConfigSubscription.LastCheck = new Date().toISOString();
      config = refineConfig(config);
      await db.saveAdminConfig(config);
      await setCachedConfig(config);
    } catch (e) {
      console.error('刷新配置失敗:', e);
    }
  } else {
    console.info('跳過刷新：未配置訂閱地址或自動更新');
  }
}

async function refreshRecordAndFavorites(deadline: number) {
  try {
    const users = await db.getAllUsers();
    if (process.env.USERNAME && !users.includes(process.env.USERNAME)) {
      users.push(process.env.USERNAME);
    }
    // 函數級快取：key 為 `${source}+${id}`，值為 Promise<VideoDetail | null>
    const detailCache = new Map<string, Promise<SearchResult | null>>();

    // 獲取詳情 Promise（帶緩存和錯誤處理）
    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string
    ): Promise<SearchResult | null> => {
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise) {
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
          // 集數刷新需要最新資料，直接打詳情 API、跳過搜尋快取
          preferDetailApi: true,
        })
          .then((detail) => {
            const successPromise = Promise.resolve(detail);
            detailCache.set(key, successPromise);
            return detail;
          })
          .catch((err) => {
            // 只印訊息不印堆疊：失效記錄每輪都會觸發，完整堆疊只是噪音
            console.error(
              `獲取影片詳情失敗 (${source}+${id}):`,
              err instanceof Error ? err.message : err
            );
            return null;
          });
        detailCache.set(key, promise);
      }
      return promise;
    };

    // 並發限制工具
    const runWithConcurrency = async <T>(
      tasks: (() => Promise<T>)[],
      concurrency: number
    ): Promise<T[]> => {
      const results: T[] = [];
      let index = 0;
      const worker = async () => {
        while (index < tasks.length) {
          if (shouldStopCron(deadline, 'next record batch')) break;

          const i = index++;
          results[i] = await tasks[i]();
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, tasks.length) }, () =>
          worker()
        )
      );
      return results;
    };

    // 處理單個使用者的播放紀錄和收藏
    const processUser = async (user: string) => {
      if (shouldStopCron(deadline, `user ${user}`)) return;

      console.info(`開始處理使用者: ${user}`);

      // 播放紀錄
      try {
        const playRecords = await db.getAllPlayRecords(user);
        const entries = Object.entries(playRecords);
        const totalRecords = entries.length;
        let processedRecords = 0;

        const tasks = entries.map(([key, record]) => async () => {
          try {
            const parsedKey = parseStorageKey(key);
            const source = record.source || parsedKey?.source;
            const id = record.vod_id || (record as any).id || parsedKey?.id;

            if (!source || !id) {
              console.warn(`跳過無法解析來源或ID的播放記錄: ${key}`);
              return;
            }

            const detail = await getDetail(source, id, record.title);
            if (!detail) {
              console.warn(`跳過無法獲取詳情的播放記錄: ${key}`);
              return;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > Number(record.total_episodes || 0)) {
              await db.savePlayRecord(user, source, id, {
                title: detail.title || record.title,
                source_name: record.source_name,
                cover: detail.poster || record.cover,
                index: record.index,
                total_episodes: episodeCount,
                play_time: record.play_time,
                year: detail.year || record.year,
                total_time: record.total_time,
                save_time: record.save_time,
                search_title: record.search_title,
              });
              console.info(
                `更新播放記錄: ${record.title} (${record.total_episodes} -> ${episodeCount})`
              );
            }

            processedRecords++;
          } catch (err) {
            console.error(`處理播放記錄失敗 (${key}):`, err);
          }
        });

        await runWithConcurrency(tasks, 2); // 限制並發數為 2，降低 1C1G CPU 負載
        console.info(`播放記錄處理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        console.error(`獲取使用者播放記錄失敗 (${user}):`, err);
      }

      // 收藏
      if (shouldStopCron(deadline, `favorites for ${user}`)) return;

      try {
        let favorites = await db.getAllFavorites(user);
        favorites = Object.fromEntries(
          Object.entries(favorites).filter(([_, fav]) => fav.origin !== 'live')
        );
        const favEntries = Object.entries(favorites);
        const totalFavorites = favEntries.length;
        let processedFavorites = 0;

        const tasks = favEntries.map(([key, fav]) => async () => {
          try {
            const parsedKey = parseStorageKey(key);
            if (!parsedKey) {
              console.warn(`跳過無效的收藏鍵: ${key}`);
              return;
            }
            const { source, id } = parsedKey;

            const favDetail = await getDetail(source, id, fav.title);
            if (!favDetail) {
              console.warn(`跳過無法獲取詳情的收藏: ${key}`);
              return;
            }

            const favEpisodeCount = favDetail.episodes?.length || 0;
            if (favEpisodeCount > Number(fav.total_episodes || 0)) {
              await db.saveFavorite(user, source, id, {
                title: favDetail.title || fav.title,
                source_name: fav.source_name,
                cover: favDetail.poster || fav.cover,
                year: favDetail.year || fav.year,
                total_episodes: favEpisodeCount,
                save_time: fav.save_time,
                search_title: fav.search_title,
              });
              console.info(
                `更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`
              );
            }

            processedFavorites++;
          } catch (err) {
            console.error(`處理收藏失敗 (${key}):`, err);
          }
        });

        await runWithConcurrency(tasks, 2); // 限制並發數為 2，降低 1C1G CPU 負載
        console.info(`收藏處理完成: ${processedFavorites}/${totalFavorites}`);
      } catch (err) {
        console.error(`獲取使用者收藏失敗 (${user}):`, err);
      }
    };

    // 使用者間並發處理（限制 1 個使用者處理完再處理下一個，防止內存溢出）
    const userTasks = users.map((user) => () => processUser(user));
    await runWithConcurrency(userTasks, 1);

    console.info('刷新播放紀錄/收藏任務完成');
  } catch (err) {
    console.error('刷新播放紀錄/收藏任務啟動失敗', err);
  }
}
