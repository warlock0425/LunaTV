/* eslint-disable @typescript-eslint/no-explicit-any */

import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { mapWithConcurrency } from '@/lib/concurrency';
import {
  fetchSubscriptionConfigFile,
  getConfig,
  getFreshConfig,
  refineConfig,
  setCachedConfig,
} from '@/lib/config';
import { markCronCompleted, markCronStarted } from '@/lib/cron-health';
import { db } from '@/lib/db';
import { fetchVideoDetail, isExactVideoDetail } from '@/lib/fetchVideoDetail';
import { refreshLiveChannels } from '@/lib/live';
import { logger } from '@/lib/logger';
import { parseStorageKey } from '@/lib/storage-key';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

let activeCronJob: Promise<'ran' | 'busy'> | null = null;
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

function startCronJob(): Promise<'ran' | 'busy'> {
  if (activeCronJob) return activeCronJob;

  const job = db.tryCronLock(async () => {
    activeCronStartedAt = new Date().toISOString();
    markCronStarted(activeCronStartedAt);
    try {
      await cronJob();
      markCronCompleted();
    } catch (error) {
      markCronCompleted(error);
      throw error;
    } finally {
      activeCronStartedAt = '';
    }
  });
  activeCronJob = job.finally(() => {
    activeCronJob = null;
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
  const provided = Buffer.from(authHeader ?? '');
  const expected = Buffer.from(expectedAuth);
  const authorized =
    provided.length === expected.length && timingSafeEqual(provided, expected);
  if (!authorized) {
    console.warn('Cron job: 未授權的訪問嘗試');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    logger.info('Cron job triggered:', new Date().toISOString());

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
      const outcome = await startCronJob();
      if (outcome === 'busy') {
        return NextResponse.json(
          {
            success: true,
            message: 'Cron job already running',
            running: true,
            timestamp: new Date().toISOString(),
          },
          {
            headers: {
              'Cache-Control': 'no-store',
            },
          }
        );
      }

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

  // 集數重新整理對使用者最有感，優先執行，避免在時間預算內被直播源重新整理餓死
  // （Vercel 上預算僅 50 秒，直播源一多就輪不到集數重新整理）
  await refreshRecordAndFavorites(deadline);
  if (shouldStopCron(deadline, 'live channel refresh')) return;

  await refreshAllLiveChannels(deadline);
}

async function refreshAllLiveChannels(deadline: number) {
  const peek = await getConfig();

  const enabledSources = (peek.LiveConfig || []).filter(
    (liveInfo) => !liveInfo.disabled
  );
  const refreshed: Array<{ key: string; nums: number }> = [];
  await mapWithConcurrency(enabledSources, 3, async (liveInfo) => {
    // 單一來源最多會用掉約 10 秒播放清單 + 12 秒 EPG；預留儲存時間，
    // 不在期限尾端再啟動一個注定超時的重新整理。
    if (Date.now() + LIVE_REFRESH_START_BUDGET_MS >= deadline) return;
    try {
      const nums = await refreshLiveChannels(liveInfo);
      refreshed.push({ key: liveInfo.key, nums });
    } catch (error) {
      console.error(
        `重新整理直播源失敗 [${liveInfo.name || liveInfo.key}]:`,
        error
      );
    }
  });

  if (refreshed.length === 0) return;

  // 網路抓取在鎖外；鎖內重讀後寫入 channelNumber
  await db.withAdminConfigLock(async () => {
    const config = await getFreshConfig();
    for (const { key, nums } of refreshed) {
      const live = config.LiveConfig?.find((l) => l.key === key);
      if (live) live.channelNumber = nums;
    }
    await db.saveAdminConfig(config);
    await setCachedConfig(config);
  });
}

async function refreshConfig() {
  const peek = await getConfig();
  if (!peek?.ConfigSubscription?.URL || !peek.ConfigSubscription.AutoUpdate) {
    logger.info('跳過重新整理：未設定訂閱地址或自動更新');
    return;
  }

  try {
    // 網路抓取不佔鎖，避免長時間卡住其他設定寫入
    const decodedContent = await fetchSubscriptionConfigFile(
      peek.ConfigSubscription.URL
    );

    // 讀→改→寫整段在鎖內；鎖後 getFreshConfig 重讀，避免覆蓋鎖外期間的管理端變更
    await db.withAdminConfigLock(async () => {
      const current = await getFreshConfig();
      if (
        !current.ConfigSubscription?.URL ||
        !current.ConfigSubscription.AutoUpdate
      ) {
        return;
      }
      const draft = structuredClone(current);
      draft.ConfigFile = decodedContent;
      draft.ConfigSubscription = {
        ...draft.ConfigSubscription,
        LastCheck: new Date().toISOString(),
      };
      const next = refineConfig(draft);
      await db.saveAdminConfig(next);
      await setCachedConfig(next);
    });
  } catch (e) {
    console.error('重新整理設定失敗:', e);
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

    // 取得詳情 Promise（帶快取和錯誤處理）
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
          // 集數重新整理需要最新資料，直接打詳情 API、跳過搜尋快取
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
              `取得影片詳情失敗 (${source}+${id}):`,
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

      logger.info(`開始處理使用者: ${user}`);

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
              console.warn(`跳過無法取得詳情的播放記錄: ${key}`);
              return;
            }
            if (!isExactVideoDetail(detail, source, id)) {
              console.warn(
                `跳過來源或ID已變更的播放記錄: ${key} -> ${detail.source}+${detail.id}`
              );
              return;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > Number(record.total_episodes || 0)) {
              const updated = await db.updatePlayRecordMetadata(
                user,
                source,
                id,
                {
                  title: detail.title || record.title,
                  cover: detail.poster || record.cover,
                  year: detail.year || record.year,
                  total_episodes: episodeCount,
                }
              );
              if (updated) {
                logger.info(
                  `更新播放記錄: ${record.title} (${record.total_episodes} -> ${episodeCount})`
                );
              }
            }

            processedRecords++;
          } catch (err) {
            console.error(`處理播放記錄失敗 (${key}):`, err);
          }
        });

        await runWithConcurrency(tasks, 6);
        logger.info(`播放記錄處理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        console.error(`取得使用者播放記錄失敗 (${user}):`, err);
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
              console.warn(`跳過無法取得詳情的收藏: ${key}`);
              return;
            }
            if (!isExactVideoDetail(favDetail, source, id)) {
              console.warn(
                `跳過來源或ID已變更的收藏: ${key} -> ${favDetail.source}+${favDetail.id}`
              );
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
              logger.info(
                `更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`
              );
            }

            processedFavorites++;
          } catch (err) {
            console.error(`處理收藏失敗 (${key}):`, err);
          }
        });

        await runWithConcurrency(tasks, 6);
        logger.info(`收藏處理完成: ${processedFavorites}/${totalFavorites}`);
      } catch (err) {
        console.error(`取得使用者收藏失敗 (${user}):`, err);
      }
    };

    const userTasks = users.map((user) => () => processUser(user));
    await runWithConcurrency(userTasks, 2);

    logger.info('重新整理播放紀錄/收藏任務完成');
  } catch (err) {
    console.error('重新整理播放紀錄/收藏任務啟動失敗', err);
  }
}
