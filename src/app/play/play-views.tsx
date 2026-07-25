'use client';

import { useRouter } from 'next/navigation';

import PageLayout from '@/components/PageLayout';

export type PlayLoadingStage =
  'searching' | 'preferring' | 'fetching' | 'ready';

/** 播放頁載入中畫面（三段式進度指示） */
export function PlayLoadingView({
  loadingStage,
  loadingMessage,
}: {
  loadingStage: PlayLoadingStage;
  loadingMessage: string;
}) {
  return (
    <PageLayout activePath='/play'>
      <div className='flex items-center justify-center min-h-screen bg-transparent'>
        <div className='text-center max-w-md mx-auto px-6'>
          <div className='relative mb-8'>
            <div className='relative mx-auto w-24 h-24 bg-surface-panel rounded-2xl shadow-2xl flex items-center justify-center border border-accent/30'>
              <div className='text-white text-4xl'>
                {loadingStage === 'searching' && '🔍'}
                {loadingStage === 'preferring' && '⚡'}
                {loadingStage === 'fetching' && '🎬'}
                {loadingStage === 'ready' && '✨'}
              </div>
              <div className='absolute -inset-1 rounded-2xl border border-accent/20' />
            </div>
          </div>

          {/* 進度指示器 */}
          <div className='mb-6 w-64 sm:w-80 mx-auto'>
            <div className='flex justify-center space-x-2 mb-4'>
              <div
                className={`w-3 h-3 rounded-full transition-all duration-500 ${
                  loadingStage === 'searching' || loadingStage === 'fetching'
                    ? 'bg-accent scale-125'
                    : loadingStage === 'preferring' || loadingStage === 'ready'
                      ? 'bg-accent'
                      : 'bg-zinc-300'
                }`}
              ></div>
              <div
                className={`w-3 h-3 rounded-full transition-all duration-500 ${
                  loadingStage === 'preferring'
                    ? 'bg-accent scale-125'
                    : loadingStage === 'ready'
                      ? 'bg-accent'
                      : 'bg-zinc-300'
                }`}
              ></div>
              <div
                className={`w-3 h-3 rounded-full transition-all duration-500 ${
                  loadingStage === 'ready'
                    ? 'bg-accent scale-125'
                    : 'bg-zinc-300'
                }`}
              ></div>
            </div>

            {/* 進度條 */}
            <div className='w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2 overflow-hidden'>
              <div
                className='h-full bg-gradient-to-r from-accent to-accent-deep rounded-full transition-all duration-1000 ease-out'
                style={{
                  width:
                    loadingStage === 'searching' || loadingStage === 'fetching'
                      ? '33%'
                      : loadingStage === 'preferring'
                        ? '66%'
                        : '100%',
                }}
              ></div>
            </div>
          </div>

          {/* 載入消息 */}
          <div className='space-y-2'>
            <p className='text-xl font-semibold text-zinc-800 dark:text-zinc-200 animate-pulse'>
              {loadingMessage}
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
          {/* 錯誤圖標 */}
          <div className='relative mb-8'>
            <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
              <div className='text-white text-4xl'>😵</div>
              {/* 脈衝效果 */}
              <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
            </div>

            {/* 浮動錯誤粒子 */}
            <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
              <div className='absolute top-2 left-2 w-2 h-2 bg-red-400 rounded-full animate-bounce'></div>
              <div
                className='absolute top-4 right-4 w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce'
                style={{ animationDelay: '0.5s' }}
              ></div>
              <div
                className='absolute bottom-3 left-6 w-1 h-1 bg-yellow-400 rounded-full animate-bounce'
                style={{ animationDelay: '1s' }}
              ></div>
            </div>
          </div>

          {/* 錯誤資訊 */}
          <div className='space-y-4 mb-8'>
            {/* 此錯誤畫面會取代整個播放頁，因此它就是該狀態下的頁面主標題 */}
            <h1 className='text-2xl font-bold text-zinc-800 dark:text-zinc-200'>
              哎呀，出現了一些問題
            </h1>
            <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
              <p className='text-red-600 dark:text-red-400 font-medium'>
                {error}
              </p>
            </div>
            <p className='text-sm font-medium text-zinc-700 dark:text-zinc-300'>
              請檢查網路連接或嘗試重新整理頁面
            </p>
          </div>

          {/* 操作按鈕 */}
          <div className='space-y-3'>
            <button
              onClick={() =>
                videoTitle
                  ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                  : router.back()
              }
              className='w-full px-6 py-3 bg-accent text-white rounded-xl font-medium hover:bg-accent-deep transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
            >
              {videoTitle ? '🔍 返回搜尋' : '← 返回上頁'}
            </button>

            <button
              onClick={() => window.location.reload()}
              className='w-full px-6 py-3 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-xl font-medium hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors duration-200'
            >
              🔄 重新嘗試
            </button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
