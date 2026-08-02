'use client';

import { AlertCircle, ArrowLeft, RefreshCw, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';

import PageLayout from '@/components/PageLayout';

export type PlayLoadingStage =
  'searching' | 'preferring' | 'fetching' | 'ready';

const STAGE_ORDER: PlayLoadingStage[] = ['searching', 'preferring', 'ready'];

function stageProgress(stage: PlayLoadingStage): number {
  if (stage === 'searching' || stage === 'fetching') return 33;
  if (stage === 'preferring') return 66;
  return 100;
}

function stageIndex(stage: PlayLoadingStage): number {
  if (stage === 'fetching') return 0;
  return Math.max(0, STAGE_ORDER.indexOf(stage));
}

/** 播放頁載入中畫面（三段式進度指示） */
export function PlayLoadingView({
  loadingStage,
  loadingMessage,
}: {
  loadingStage: PlayLoadingStage;
  loadingMessage: string;
}) {
  const active = stageIndex(loadingStage);
  const progress = stageProgress(loadingStage);

  return (
    <PageLayout activePath='/play'>
      <div className='flex items-center justify-center min-h-screen bg-transparent'>
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

          <div className='mb-6 w-64 sm:w-80 mx-auto'>
            <div className='flex justify-center space-x-2 mb-4' aria-hidden>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
                    i <= active ? 'bg-accent scale-110' : 'bg-zinc-600'
                  }`}
                />
              ))}
            </div>

            <div className='w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden'>
              <div
                className='h-full bg-accent rounded-full transition-all duration-700 ease-out'
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className='space-y-2'>
            <p className='text-lg font-semibold text-zinc-100'>
              {loadingMessage}
            </p>
            <p className='text-sm text-zinc-500'>
              {loadingStage === 'searching' || loadingStage === 'fetching'
                ? '正在尋找可用片源…'
                : loadingStage === 'preferring'
                  ? '正在測速並選擇較佳來源…'
                  : '即將開始播放…'}
            </p>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

/** 播放頁錯誤畫面（返回搜尋／重新嘗試） */
export function PlayErrorView({
  error,
  videoTitle,
}: {
  error: string;
  videoTitle: string;
}) {
  const router = useRouter();
  return (
    <PageLayout activePath='/play'>
      <div className='flex items-center justify-center min-h-screen bg-transparent'>
        <div className='text-center max-w-md mx-auto px-6'>
          <div className='relative mb-8'>
            <div className='relative mx-auto w-20 h-20 bg-surface-panel rounded-2xl shadow-2xl flex items-center justify-center border border-red-500/35'>
              <AlertCircle className='w-9 h-9 text-red-400' aria-hidden />
            </div>
          </div>

          <div className='space-y-4 mb-8'>
            {/* e2e 依賴此文案；請勿隨意更動 */}
            <h1 className='text-2xl font-bold text-zinc-100'>
              哎呀，出現了一些問題
            </h1>
            <div className='bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-left'>
              <p className='text-red-300 font-medium break-words'>{error}</p>
            </div>
            <p className='text-sm text-zinc-400 leading-relaxed'>
              可換一個片源、檢查網路，或重新整理後再試一次。
            </p>
          </div>

          <div className='space-y-3'>
            <button
              type='button'
              onClick={() =>
                videoTitle
                  ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                  : router.back()
              }
              className='w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-accent text-white rounded-xl font-medium hover:bg-accent/90 transition-colors shadow-lg shadow-accent/15'
            >
              {videoTitle ? (
                <>
                  <Search className='w-4 h-4' aria-hidden />
                  返回搜尋
                </>
              ) : (
                <>
                  <ArrowLeft className='w-4 h-4' aria-hidden />
                  返回上頁
                </>
              )}
            </button>

            <button
              type='button'
              onClick={() => window.location.reload()}
              className='w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-white/5 text-zinc-200 rounded-xl font-medium border border-white/10 hover:bg-white/10 transition-colors'
            >
              <RefreshCw className='w-4 h-4' aria-hidden />
              重新嘗試
            </button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
