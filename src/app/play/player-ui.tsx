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

/** 簡介超過這個字數就預設收合，避免長簡介把下方的選集操作區擠掉 */
const DESC_COLLAPSE_LENGTH = 180;

/** 影片詳情展示：預設收合，避免與頂部標題重複佔高；展開後才看簡介／封面 */
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
  const [panelOpen, setPanelOpen] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const coverImgError = Boolean(videoCover && failedCover === videoCover);

  const yearLabel = formatYear(detail?.year || videoYear);
  const sourceLabel = detail?.source_name || '';
  const desc = detail?.desc?.trim() || '';
  // 以「字元」而非「UTF-16 碼元」計數與截斷：簡介可能含 emoji 或 BMP 以外的
  // 罕用字（代理對佔兩個碼元），用 slice 會把一個字劈成兩半、渲染出破字。
  const descChars = useMemo(() => Array.from(desc), [desc]);
  const descIsLong = descChars.length > DESC_COLLAPSE_LENGTH;
  const shownDesc =
    descIsLong && !descExpanded
      ? `${descChars.slice(0, DESC_COLLAPSE_LENGTH).join('').trimEnd()}…`
      : desc;

  return (
    <section className='rounded-xl border border-white/10 bg-zinc-900/40 overflow-hidden'>
      {/* 精簡列：收藏／年份／片源常駐；完整詳情按需展開 */}
      <div className='flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3'>
        <button
          type='button'
          onClick={() => setPanelOpen((v) => !v)}
          aria-expanded={panelOpen}
          className='flex flex-1 items-center gap-2 min-w-0 text-left hover:opacity-90 transition-opacity'
        >
          <span className='text-sm font-semibold text-zinc-100 shrink-0'>
            影片資訊
          </span>
          {yearLabel && (
            <span className='text-xs text-zinc-400 tabular-nums shrink-0'>
              {yearLabel}
            </span>
          )}
          {sourceLabel && (
            <span
              title={sourceLabel}
              className='max-w-[8rem] sm:max-w-[14rem] truncate text-[11px] px-1.5 py-0.5 rounded border border-zinc-600/70 text-zinc-300'
            >
              {sourceLabel}
            </span>
          )}
          {detail?.class && (
            <span className='hidden sm:inline text-xs text-accent font-medium truncate'>
              {detail.class}
            </span>
          )}
          <span className='ml-auto text-xs font-medium text-accent shrink-0'>
            {panelOpen ? '收合' : '展開'}
          </span>
        </button>
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          className='flex-shrink-0 hover:opacity-80 transition-opacity p-1'
          aria-label={favorited ? '取消收藏' : '加入收藏'}
        >
          <FavoriteIcon filled={favorited} />
        </button>
      </div>

      {panelOpen && (
        <div className='border-t border-white/10 grid grid-cols-1 md:grid-cols-4 gap-4 p-4 sm:p-5'>
          <div className='md:col-span-3 min-w-0'>
            {/* 不再用巨大 h1 重覆頂部片名，改以次要標題呈現 */}
            <p
              className='text-base sm:text-lg font-semibold text-zinc-200 mb-3 line-clamp-2'
              title={videoTitle || undefined}
            >
              {videoTitle || '影片標題'}
            </p>

            <div className='flex flex-wrap items-center gap-2 text-sm text-zinc-400 mb-3'>
              {detail?.type_name && <span>{detail.type_name}</span>}
              {detail?.class && (
                <span className='sm:hidden text-accent'>{detail.class}</span>
              )}
            </div>

            {desc && (
              <div className='text-sm leading-relaxed text-zinc-300'>
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

          <div className='md:col-span-1 md:order-first'>
            <div className='relative mx-auto w-28 sm:w-full max-w-[160px] bg-zinc-800 aspect-[2/3] flex items-center justify-center rounded-xl overflow-hidden ring-1 ring-white/10'>
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
                      className='absolute top-2 left-2'
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
      )}
    </section>
  );
}
