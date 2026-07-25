/* eslint-disable @next/next/no-img-element */
'use client';

import { useState } from 'react';

import { SearchResult } from '@/lib/types';
import { formatYear, getProxiedImageUrl, processImageUrl } from '@/lib/utils';

import { FavoriteIcon } from './FavoriteIcon';

/** 跳過片頭/片尾浮動按鈕 */
export function SkipButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className='absolute bottom-16 right-4 z-[100] px-4 py-2 bg-black/70 hover:bg-black/90 text-white border border-white/20 rounded-lg shadow-lg backdrop-blur-sm transition-all text-sm font-medium flex items-center space-x-1'
    >
      <span>{label}</span>
      <svg className='w-4 h-4' fill='currentColor' viewBox='0 0 24 24'>
        <path d='M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z' />
      </svg>
    </button>
  );
}

/** 換源/初始化載入蒙層 */
export function VideoLoadingOverlay({
  stage,
}: {
  stage: 'initing' | 'sourceChanging';
}) {
  return (
    <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl flex items-center justify-center z-[500] transition-all duration-300'>
      <div className='text-center max-w-md mx-auto px-6'>
        <div className='relative mb-8'>
          <div className='relative mx-auto w-24 h-24 bg-[#17171c] rounded-2xl shadow-2xl flex items-center justify-center border border-accent/30'>
            <div className='text-white text-4xl'>🎬</div>
            <div className='absolute -inset-1 rounded-2xl border border-accent/20' />
          </div>
        </div>

        {/* 換源消息 */}
        <div className='space-y-2'>
          <p className='text-xl font-semibold text-white animate-pulse'>
            {stage === 'sourceChanging'
              ? '🔄 切換播放源...'
              : '🔄 影片載入中...'}
          </p>
        </div>
      </div>
    </div>
  );
}

/** 自動連播倒數計時蒙層 */
export function AutoNextCountdownOverlay({
  countdown,
  onPlayNow,
  onCancel,
}: {
  countdown: number;
  onPlayNow: () => void;
  onCancel: () => void;
}) {
  return (
    <div className='absolute inset-0 bg-black/80 backdrop-blur-sm rounded-xl flex items-center justify-center z-[501] transition-all duration-300'>
      <div className='text-center max-w-sm mx-auto px-6'>
        <p className='text-lg text-white/80 mb-3'>下一集即將播放</p>
        <div className='text-6xl font-bold text-accent mb-6 animate-pulse'>
          {countdown}
        </div>
        <div className='flex gap-3 justify-center'>
          <button
            onClick={onPlayNow}
            className='px-5 py-2.5 bg-accent hover:bg-accent-deep text-white font-medium rounded-xl transition-colors text-sm'
          >
            立即播放
          </button>
          <button
            onClick={onCancel}
            className='px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white font-medium rounded-xl transition-colors text-sm border border-white/20'
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

const SHORTCUT_ROWS: [string, string][] = [
  ['空白鍵', '播放 / 暫停'],
  ['F', '切換全螢幕'],
  ['← / →', '快退 / 快進 10 秒'],
  ['↑ / ↓', '增減音量'],
  ['[ / ]', '減速 / 加速播放'],
  ['M', '靜音切換'],
  ['Alt + ← / →', '上 / 下一集'],
  ['? / H', '快捷鍵幫助'],
];

/** 快捷鍵幫助面板 */
export function ShortcutsHelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className='fixed inset-0 z-[999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4'
      onClick={onClose}
    >
      <div
        className='bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl'
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className='text-white font-bold text-lg mb-4'>快捷鍵幫助</h3>
        <div className='space-y-2.5 text-sm'>
          {SHORTCUT_ROWS.map(([key, desc]) => (
            <div key={key} className='flex justify-between'>
              <span className='text-zinc-400'>{key}</span>
              <span className='text-white'>{desc}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className='w-full mt-5 py-2.5 bg-accent hover:bg-accent-deep text-white font-medium rounded-xl transition-colors text-sm'
        >
          關閉
        </button>
      </div>
    </div>
  );
}

/** 選集面板摺疊切換按鈕（僅 lg 以上顯示） */
export function EpisodeCollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className='hidden lg:flex justify-end'>
      <button
        onClick={onToggle}
        className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/80 hover:bg-white dark:bg-zinc-800/80 dark:hover:bg-zinc-800 backdrop-blur-sm border border-zinc-200/50 dark:border-zinc-700/50 shadow-sm hover:shadow-md transition-all duration-200'
        title={collapsed ? '顯示選集面板' : '隱藏選集面板'}
      >
        <svg
          className={`w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300 transition-transform duration-200 ${
            collapsed ? 'rotate-180' : 'rotate-0'
          }`}
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2'
            d='M9 5l7 7-7 7'
          />
        </svg>
        <span className='text-xs font-medium text-zinc-600 dark:text-zinc-300'>
          {collapsed ? '顯示' : '隱藏'}
        </span>

        {/* 精緻的狀態指示點 */}
        <div
          className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${
            collapsed ? 'bg-orange-400 animate-pulse' : 'bg-accent'
          }`}
        ></div>
      </button>
    </div>
  );
}

/** 影片詳情展示（標題/收藏/關鍵資訊/簡介/封面/豆瓣連結） */
export function VideoDetailsPanel({
  detail,
  videoTitle,
  videoYear,
  videoCover,
  videoDoubanId,
  favorited,
  onToggleFavorite,
}: {
  detail: SearchResult | null;
  videoTitle: string;
  videoYear: string;
  videoCover: string;
  videoDoubanId: number;
  favorited: boolean;
  onToggleFavorite: () => void;
}) {
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const coverImgError = Boolean(videoCover && failedCover === videoCover);

  return (
    <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
      {/* 文字區 */}
      <div className='md:col-span-3'>
        <div className='p-6 flex flex-col min-h-0'>
          {/* 標題 */}
          <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center flex-shrink-0 text-center md:text-left w-full'>
            {videoTitle || '影片標題'}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className='ml-3 flex-shrink-0 hover:opacity-80 transition-opacity'
            >
              <FavoriteIcon filled={favorited} />
            </button>
          </h1>

          {/* 關鍵資訊行 */}
          <div className='flex flex-wrap items-center gap-3 text-base mb-4 text-zinc-700 dark:text-zinc-300 flex-shrink-0'>
            {detail?.class && (
              <span className='text-accent font-semibold'>{detail.class}</span>
            )}
            {formatYear(detail?.year || videoYear) && (
              <span>{formatYear(detail?.year || videoYear)}</span>
            )}
            {detail?.source_name && (
              <span
                title={detail.source_name}
                className='max-w-full truncate border border-zinc-500/60 px-2 py-[1px] rounded'
              >
                {detail.source_name}
              </span>
            )}
            {detail?.type_name && <span>{detail.type_name}</span>}
          </div>
          {/* 劇情簡介 */}
          {detail?.desc && (
            <div
              className='mt-0 text-base leading-relaxed text-zinc-700 dark:text-zinc-300 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
              style={{ whiteSpace: 'pre-line' }}
            >
              {detail.desc}
            </div>
          )}
        </div>
      </div>

      {/* 封面展示 */}
      <div className='hidden md:block md:col-span-1 md:order-first'>
        <div className='pl-0 py-4 pr-6'>
          <div className='relative bg-zinc-300 dark:bg-zinc-700 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden'>
            {videoCover && !coverImgError ? (
              <>
                <img
                  src={processImageUrl(videoCover)}
                  alt={videoTitle}
                  className='w-full h-full object-cover'
                  referrerPolicy='no-referrer'
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.dataset.retried && videoCover) {
                      // 直連失敗，改走伺服器代理
                      img.dataset.retried = 'true';
                      img.src = getProxiedImageUrl(videoCover);
                      return;
                    }
                    setFailedCover(videoCover);
                  }}
                />

                {/* 豆瓣鏈接按鈕 */}
                {videoDoubanId !== 0 && (
                  <a
                    href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='absolute top-3 left-3'
                  >
                    <div className='bg-accent text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-accent-deep hover:scale-[1.1] transition-all duration-300 ease-out'>
                      <svg
                        width='16'
                        height='16'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      >
                        <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                        <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                      </svg>
                    </div>
                  </a>
                )}
              </>
            ) : (
              <span className='text-zinc-700 dark:text-zinc-300'>
                {coverImgError ? videoTitle : '封面圖片'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
