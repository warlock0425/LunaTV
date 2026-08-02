'use client';

import { CirclePlay, ListVideo, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { buildPlayUrl } from '@/lib/play-url';
import { formatYear } from '@/lib/utils';

import { ContinueWatchingCover } from './ContinueWatchingCover';
import { PosterImage } from './PosterImage';
import {
  formatEpisodeLabel,
  formatSourceLabel,
  getWatchProgress,
  resolveRecordPlayTarget,
} from './utils';

interface HeroRecord {
  key?: string;
  id?: string;
  vod_id?: string;
  source?: string;
  source_name?: string;
  title?: string;
  vod_name?: string;
  cover?: string;
  year?: string;
  index?: number;
  total_episodes?: number;
  play_time?: number;
  total_time?: number;
  search_title?: string;
  url?: string;
}

function formatRemainingTime(playTime: number, totalTime: number): string {
  const left = Math.max(0, Math.round(totalTime - playTime));
  if (left < 60) return '快看完了';
  const minutes = Math.round(left / 60);
  if (minutes < 60) return `還剩 ${minutes} 分鐘`;
  const hours = Math.floor(minutes / 60);
  return `還剩 ${hours} 小時 ${minutes % 60} 分鐘`;
}

/**
 * 首頁頂部的「接著看」區塊：直接鎖定最後觀看的一部，讓回訪只需一次點擊。
 */
export function HeroResume({
  item,
  othersCount,
  onClearHistory,
  onResolvedCover,
}: {
  item: HeroRecord;
  othersCount: number;
  /** 只有在下方沒有繼續觀看列可放清空按鈕時才傳入（例如全站僅剩這一筆紀錄） */
  onClearHistory?: () => void;
  /** 補到封面後寫回紀錄，與下方列表共用同一個處理函式 */
  onResolvedCover?: (poster: string) => void | Promise<void>;
}) {
  const router = useRouter();

  const title = item.title || item.vod_name || '';
  const { source, id, isPrefer } = resolveRecordPlayTarget(item);

  const playHref = buildPlayUrl({
    id,
    source,
    title,
    prefer: isPrefer,
    url: item.url,
    stitle: item.search_title,
    episode: item.index && item.index > 0 ? item.index : undefined,
  });

  const totalTime = Number(item.total_time) || 0;
  const playTime = Number(item.play_time) || 0;
  const progress = getWatchProgress(item);
  const episodeLabel = formatEpisodeLabel(item);
  const sourceLabel = formatSourceLabel(item, source);
  const yearLabel = formatYear(item.year);

  return (
    <section className='mb-10'>
      <div className='relative overflow-hidden rounded-2xl bg-zinc-900 h-[340px] sm:h-[380px] lg:h-[420px]'>
        {/* 背景：海報是 2:3 直式，放大並模糊後才鋪得滿橫幅。
            沒有封面時改用漸層——PosterImage 的無圖後備是「印出標題」，
            在這裡會變成一團模糊的字糊在背景上，而且與右側海報、h2 三度重複。 */}
        {item.cover ? (
          <>
            <div
              aria-hidden='true'
              className='absolute inset-0 scale-125 blur-2xl opacity-60'
            >
              <PosterImage
                src={item.cover}
                title={title}
                className='object-cover'
              />
            </div>
            {/* 遮罩只在有圖時需要——它的作用是壓住花俏的畫面讓文字讀得清楚 */}
            <div className='absolute inset-0 bg-gradient-to-r from-black/95 via-black/80 to-black/40' />
            <div className='absolute inset-0 bg-gradient-to-t from-black/80 to-transparent' />
          </>
        ) : (
          <div
            aria-hidden='true'
            className='absolute inset-0 bg-gradient-to-br from-accent/30 via-zinc-900 to-black'
          />
        )}

        <div className='relative h-full flex items-center gap-8 px-6 sm:px-10 lg:px-14'>
          <div className='min-w-0 flex-1 max-w-2xl'>
            <p className='flex items-center gap-2 text-accent text-xs font-bold tracking-[0.2em] uppercase mb-3'>
              <CirclePlay className='w-4 h-4' />
              接著看
            </p>

            <h2 className='text-white text-2xl sm:text-3xl lg:text-4xl font-bold leading-tight line-clamp-2 text-balance'>
              {title}
            </h2>

            <div className='mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-300'>
              <span className='font-semibold tabular-nums'>{episodeLabel}</span>
              {yearLabel && (
                <>
                  <span aria-hidden='true' className='text-zinc-600'>
                    ·
                  </span>
                  <span className='tabular-nums'>{yearLabel}</span>
                </>
              )}
              {sourceLabel && (
                <>
                  <span aria-hidden='true' className='text-zinc-600'>
                    ·
                  </span>
                  <span className='px-2 py-0.5 bg-accent/15 text-accent border border-accent/20 text-[11px] font-bold rounded-sm'>
                    {sourceLabel}
                  </span>
                </>
              )}
            </div>

            {progress > 0 && (
              <div className='mt-5 max-w-sm'>
                <div className='flex items-center justify-between text-xs text-zinc-400 mb-1.5 tabular-nums'>
                  <span>{progress}% 已觀看</span>
                  <span>{formatRemainingTime(playTime, totalTime)}</span>
                </div>
                <div className='h-2 w-full rounded-full bg-white/15 overflow-hidden'>
                  <div
                    className='h-full rounded-full bg-accent shadow-[0_0_12px_rgba(0,180,216,0.45)]'
                    style={{ width: `${Math.max(progress, 2)}%` }}
                  />
                </div>
              </div>
            )}

            <div className='mt-6 flex flex-wrap items-center gap-3'>
              <button
                type='button'
                onClick={() => router.push(playHref)}
                className='flex items-center gap-2 rounded-lg bg-accent px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-accent/20 transition hover:bg-accent/90 active:scale-95'
              >
                <CirclePlay className='w-5 h-5' />
                繼續播放
              </button>
              <button
                type='button'
                onClick={() => router.push(playHref)}
                className='flex items-center gap-2 rounded-lg bg-white/10 px-5 py-3.5 text-sm font-medium text-zinc-100 border border-white/10 transition hover:bg-white/15 active:scale-95'
              >
                <ListVideo className='w-5 h-5' />
                選集
              </button>
              {othersCount > 0 && (
                <a
                  href='#continue-watching'
                  className='text-xs text-zinc-400 hover:text-accent tabular-nums transition-colors underline-offset-2 hover:underline'
                >
                  另外還有 {othersCount} 部在追
                </a>
              )}
              {onClearHistory && (
                <button
                  onClick={onClearHistory}
                  className='flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-red-400 transition-colors'
                >
                  <Trash2 className='w-3.5 h-3.5' />
                  清空紀錄
                </button>
              )}
            </div>
          </div>

          {/* 清晰海報：改用 ContinueWatchingCover，與下方列表共用同一套補圖
              （本地詳情快取 → 詳情 API → 載入失敗改走代理），補到的封面會
              寫回紀錄，模糊背景也跟著有圖。 */}
          <div className='hidden lg:block shrink-0'>
            <div className='relative w-[190px] aspect-[2/3] overflow-hidden rounded-xl bg-zinc-800 shadow-2xl ring-1 ring-white/10'>
              <ContinueWatchingCover
                cover={item.cover}
                title={title}
                source={source}
                id={id}
                onResolvedCover={onResolvedCover}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
