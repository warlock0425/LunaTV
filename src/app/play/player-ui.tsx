/* eslint-disable @next/next/no-img-element */
'use client';

import { useMemo, useState } from 'react';

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
      type='button'
      onClick={onClick}
      className='absolute bottom-16 right-4 z-[100] min-h-11 px-4 py-2.5 bg-black/75 hover:bg-black/90 active:scale-[0.98] text-white border border-white/25 rounded-xl shadow-lg backdrop-blur-sm transition-all text-sm font-medium flex items-center gap-1.5'
    >
      <span>{label}</span>
      <svg
        className='w-4 h-4 opacity-90'
        fill='currentColor'
        viewBox='0 0 24 24'
        aria-hidden
      >
        <path d='M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z' />
      </svg>
    </button>
  );
}

/** 播放中可恢復的錯誤：不踢出整頁，在播放器上提供重試／自動換源 */
export function PlaybackSoftErrorOverlay({
  message,
  onRetry,
  onAutoSwitch,
  autoSwitchLabel,
  onBrowseSources,
  onDismiss,
}: {
  message: string;
  onRetry: () => void;
  onAutoSwitch?: () => void;
  autoSwitchLabel?: string;
  onBrowseSources?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className='absolute inset-0 z-[520] flex items-center justify-center bg-black/80 backdrop-blur-sm rounded-xl p-4'>
      <div className='w-full max-w-sm text-center space-y-4'>
        <p className='text-base font-semibold text-white'>播放出了問題</p>
        <p className='text-sm text-zinc-300 leading-relaxed break-words'>
          {message}
        </p>
        <div className='flex flex-col gap-2 justify-center'>
          <button
            type='button'
            onClick={onRetry}
            className='px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent/90 transition-colors'
          >
            重試目前來源
          </button>
          {onAutoSwitch && (
            <button
              type='button'
              onClick={onAutoSwitch}
              className='px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 text-zinc-100 text-sm font-medium hover:bg-white/15 transition-colors'
            >
              {autoSwitchLabel || '自動切換至下一個可用來源'}
            </button>
          )}
          {onBrowseSources && (
            <button
              type='button'
              onClick={onBrowseSources}
              className='px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-zinc-200 text-sm font-medium hover:bg-white/10 transition-colors'
            >
              前往換源
            </button>
          )}
        </div>
        {onDismiss && (
          <button
            type='button'
            onClick={onDismiss}
            className='text-xs text-zinc-500 hover:text-zinc-300 transition-colors'
          >
            關閉
          </button>
        )}
      </div>
    </div>
  );
}

/** 播放器內角標：全螢幕時仍看得到集數 */
export function PlayerEpisodeBadge({ label }: { label: string }) {
  if (!label) return null;
  return (
    <div className='pointer-events-none absolute top-3 left-3 z-[90] max-w-[70%]'>
      <span className='inline-block truncate rounded-full border border-white/20 bg-black/55 px-2.5 py-1 text-xs font-semibold text-white shadow-lg backdrop-blur-sm'>
        {label}
      </span>
    </div>
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
          <div className='relative mx-auto w-20 h-20 bg-surface-panel rounded-2xl shadow-2xl flex items-center justify-center border border-accent/30'>
            <div
              className='h-9 w-9 rounded-full border-2 border-accent/25 border-t-accent animate-spin'
              aria-hidden
            />
            <div className='absolute -inset-1 rounded-2xl border border-accent/15' />
          </div>
        </div>

        <div className='space-y-2'>
          <p className='text-lg font-semibold text-white'>
            {stage === 'sourceChanging' ? '切換播放源…' : '影片載入中…'}
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
            className='px-5 py-2.5 bg-accent hover:bg-accent/90 text-white font-medium rounded-xl transition-colors text-sm'
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
          type='button'
          onClick={onClose}
          className='w-full mt-5 py-2.5 bg-accent hover:bg-accent/90 text-white font-medium rounded-xl transition-colors text-sm'
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
        type='button'
        onClick={onToggle}
        className='group relative flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-800/90 hover:bg-zinc-800 backdrop-blur-sm border border-zinc-700/60 shadow-sm hover:border-accent/40 transition-all duration-200'
        title={collapsed ? '顯示選集與換源' : '收合側欄以放大播放器'}
        aria-expanded={!collapsed}
      >
        <svg
          className={`w-3.5 h-3.5 text-zinc-300 transition-transform duration-200 ${
            collapsed ? 'rotate-180' : 'rotate-0'
          }`}
          fill='none'
          stroke='currentColor'
          viewBox='0 0 24 24'
          aria-hidden
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            strokeWidth='2'
            d='M9 5l7 7-7 7'
          />
        </svg>
        <span className='text-xs font-medium text-zinc-200'>
          {collapsed ? '顯示選集' : '收合側欄'}
        </span>
        <div
          className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${
            collapsed ? 'bg-orange-400 animate-pulse' : 'bg-accent'
          }`}
          aria-hidden
        />
      </button>
    </div>
  );
}

/** 簡介超過這個字數就預設收合，避免長簡介把下方操作區擠掉 */
const DESC_COLLAPSE_LENGTH = 180;

/** 影片詳情：封面 + 標題 + 資訊 + 簡介（完整版型，不再用空蕩的收合列） */
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
  const [descExpanded, setDescExpanded] = useState(false);
  const coverImgError = Boolean(videoCover && failedCover === videoCover);

  const desc = detail?.desc?.trim() || '';
  // 以「字元」計數與截斷，避免 emoji／罕用字被 slice 劈成破字
  const descChars = useMemo(() => Array.from(desc), [desc]);
  const descIsLong = descChars.length > DESC_COLLAPSE_LENGTH;
  const shownDesc =
    descIsLong && !descExpanded
      ? `${descChars.slice(0, DESC_COLLAPSE_LENGTH).join('').trimEnd()}…`
      : desc;

  return (
    <div className='grid grid-cols-1 md:grid-cols-4 gap-4 rounded-xl border border-white/10 bg-zinc-900/30'>
      <div className='md:col-span-3'>
        <div className='p-5 sm:p-6 flex flex-col min-h-0'>
          <h2 className='text-xl sm:text-2xl font-bold mb-3 tracking-wide flex items-center flex-shrink-0 text-zinc-100'>
            <span className='min-w-0 line-clamp-2'>
              {videoTitle || '影片標題'}
            </span>
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              className='ml-3 flex-shrink-0 hover:opacity-80 transition-opacity'
              aria-label={favorited ? '取消收藏' : '加入收藏'}
            >
              <FavoriteIcon filled={favorited} />
            </button>
          </h2>

          <div className='flex flex-wrap items-center gap-2 sm:gap-3 text-sm mb-4 text-zinc-400 flex-shrink-0'>
            {detail?.class && (
              <span className='text-accent font-semibold'>{detail.class}</span>
            )}
            {formatYear(detail?.year || videoYear) && (
              <span className='tabular-nums'>
                {formatYear(detail?.year || videoYear)}
              </span>
            )}
            {detail?.source_name && (
              <span
                title={detail.source_name}
                className='max-w-[12rem] sm:max-w-full truncate border border-zinc-600/70 px-2 py-0.5 rounded text-xs text-zinc-300'
              >
                {detail.source_name}
              </span>
            )}
            {detail?.type_name && <span>{detail.type_name}</span>}
          </div>

          {desc && (
            <div className='text-sm sm:text-base leading-relaxed text-zinc-300 flex-1 min-h-0'>
              <p style={{ whiteSpace: 'pre-line' }}>{shownDesc}</p>
              {descIsLong && (
                <button
                  type='button'
                  onClick={() => setDescExpanded((v) => !v)}
                  className='mt-2 text-sm font-medium text-accent hover:text-accent/80 transition-colors'
                >
                  {descExpanded ? '收合簡介' : '展開全部簡介'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className='hidden md:block md:col-span-1 md:order-first'>
        <div className='p-5 pr-2'>
          <div className='relative bg-zinc-800 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden ring-1 ring-white/10 max-w-[200px]'>
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
                      img.dataset.retried = 'true';
                      img.src = getProxiedImageUrl(videoCover);
                      return;
                    }
                    setFailedCover(videoCover);
                  }}
                />
                {videoDoubanId !== 0 && (
                  <a
                    href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='absolute top-3 left-3'
                    aria-label='在豆瓣開啟'
                  >
                    <div className='bg-accent text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-accent/90 hover:scale-[1.05] transition-all'>
                      <svg
                        width='16'
                        height='16'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        aria-hidden
                      >
                        <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                        <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                      </svg>
                    </div>
                  </a>
                )}
              </>
            ) : (
              <span className='text-zinc-500 text-xs px-2 text-center'>
                {coverImgError ? '封面載入失敗' : '無封面'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
