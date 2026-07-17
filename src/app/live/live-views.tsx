/* eslint-disable @next/next/no-img-element */
'use client';

import { Radio, Tv } from 'lucide-react';

import PageLayout from '@/components/PageLayout';

import { LiveChannel, LiveSource } from './live-types';
import { buildLiveLogoProxyUrl } from './live-url';

export type LiveLoadingStage = 'loading' | 'fetching' | 'ready';

/** 直播頁載入畫面 */
export function LiveLoadingView({
  loadingStage,
  loadingMessage,
}: {
  loadingStage: LiveLoadingStage;
  loadingMessage: string;
}) {
  return (
    <PageLayout activePath='/live'>
      <div className='flex items-center justify-center min-h-screen bg-transparent'>
        <div className='text-center max-w-md mx-auto px-6'>
          {/* 動畫直播圖標 */}
          <div className='relative mb-8'>
            <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-accent to-[#cc3256] rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
              <div className='text-white text-4xl'>📺</div>
              {/* 旋轉光環 */}
              <div className='absolute -inset-2 bg-gradient-to-r from-accent to-[#cc3256] rounded-2xl opacity-20 animate-spin'></div>
            </div>

            {/* 浮動粒子效果 */}
            <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
              <div className='absolute top-2 left-2 w-2 h-2 bg-accent rounded-full animate-bounce'></div>
              <div
                className='absolute top-4 right-4 w-1.5 h-1.5 bg-red-400 rounded-full animate-bounce'
                style={{ animationDelay: '0.5s' }}
              ></div>
              <div
                className='absolute bottom-3 left-6 w-1 h-1 bg-red-300 rounded-full animate-bounce'
                style={{ animationDelay: '1s' }}
              ></div>
            </div>
          </div>

          {/* 進度指示器 */}
          <div className='mb-6 w-64 sm:w-80 mx-auto'>
            <div className='flex justify-center space-x-2 mb-4'>
              <div
                className={`w-3 h-3 rounded-full transition-all duration-500 ${
                  loadingStage === 'loading'
                    ? 'bg-accent scale-125'
                    : 'bg-accent'
                }`}
              ></div>
              <div
                className={`w-3 h-3 rounded-full transition-all duration-500 ${
                  loadingStage === 'fetching'
                    ? 'bg-accent scale-125'
                    : 'bg-accent'
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
                className='h-full bg-gradient-to-r from-accent to-[#cc3256] rounded-full transition-all duration-1000 ease-out'
                style={{
                  width:
                    loadingStage === 'loading'
                      ? '33%'
                      : loadingStage === 'fetching'
                        ? '66%'
                        : '100%',
                }}
              ></div>
            </div>
          </div>

          {/* 加載消息 */}
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

/** 直播頁錯誤畫面 */
export function LiveErrorView({ error }: { error: string }) {
  return (
    <PageLayout activePath='/live'>
      <div className='flex items-center justify-center min-h-screen bg-transparent'>
        <div className='text-center max-w-md mx-auto px-6'>
          {/* 錯誤圖標 */}
          <div className='relative mb-8'>
            <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
              <div className='text-white text-4xl'>😵</div>
              {/* 脈衝效果 */}
              <div className='absolute -inset-2 bg-gradient-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
            </div>
          </div>

          {/* 錯誤資訊 */}
          <div className='space-y-4 mb-8'>
            <h2 className='text-2xl font-bold text-zinc-800 dark:text-zinc-200'>
              哎呀，出現了一些問題
            </h2>
            <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
              <p className='text-red-600 dark:text-red-400 font-medium'>
                {error}
              </p>
            </div>
            <p className='text-sm text-zinc-500 dark:text-zinc-400'>
              請檢查網路連接或嘗試重新整理頁面
            </p>
          </div>

          {/* 操作按鈕 */}
          <div className='space-y-3'>
            <button
              onClick={() => window.location.reload()}
              className='w-full px-6 py-3 bg-gradient-to-r from-accent to-[#cc3256] text-white rounded-xl font-medium hover:from-[#cc3256] hover:to-[#8a0510] transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
            >
              🔄 重新嘗試
            </button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
}

/** 不支持的直播流類型提示蒙層 */
export function UnsupportedTypeOverlay({ type }: { type: string }) {
  return (
    <div className='absolute inset-0 bg-black/90 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30 flex items-center justify-center z-[600] transition-all duration-300'>
      <div className='text-center max-w-md mx-auto px-6'>
        <div className='relative mb-8'>
          <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-orange-500 to-red-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
            <div className='text-white text-4xl'>⚠️</div>
            <div className='absolute -inset-2 bg-gradient-to-r from-orange-500 to-red-600 rounded-2xl opacity-20 animate-pulse'></div>
          </div>
        </div>
        <div className='space-y-4'>
          <h3 className='text-xl font-semibold text-white'>
            暫不支持的直播流類型
          </h3>
          <div className='bg-orange-500/20 border border-orange-500/30 rounded-lg p-4'>
            <p className='text-orange-300 font-medium'>
              當前頻道直播流類型：
              <span className='text-white font-bold'>{type.toUpperCase()}</span>
            </p>
            <p className='text-sm text-orange-200 mt-2'>
              目前僅支持 M3U8 格式的直播流
            </p>
          </div>
          <p className='text-sm text-zinc-300'>請嘗試其他頻道</p>
        </div>
      </div>
    </div>
  );
}

/** IPTV 影片加載蒙層 */
export function LiveVideoLoadingOverlay() {
  return (
    <div className='absolute inset-0 bg-black/85 backdrop-blur-sm rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30 flex items-center justify-center z-[500] transition-all duration-300'>
      <div className='text-center max-w-md mx-auto px-6'>
        <div className='relative mb-8'>
          <div className='relative mx-auto w-24 h-24 bg-gradient-to-r from-accent to-[#cc3256] rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
            <div className='text-white text-4xl'>📺</div>
            <div className='absolute -inset-2 bg-gradient-to-r from-accent to-[#cc3256] rounded-2xl opacity-20 animate-spin'></div>
          </div>
        </div>
        <div className='space-y-2'>
          <p className='text-xl font-semibold text-white animate-pulse'>
            🔄 IPTV 加載中...
          </p>
        </div>
      </div>
    </div>
  );
}

/** 頻道清單（頻道 Tab 的列表主體） */
export function LiveChannelList({
  listRef,
  channels,
  currentChannel,
  sourceKey,
  isSwitchingSource,
  onChannelChange,
}: {
  listRef: React.RefObject<HTMLDivElement | null>;
  channels: LiveChannel[];
  currentChannel: LiveChannel | null;
  sourceKey?: string;
  isSwitchingSource: boolean;
  onChannelChange: (channel: LiveChannel) => void;
}) {
  return (
    <div ref={listRef} className='flex-1 overflow-y-auto space-y-2 pb-4'>
      {channels.length > 0 ? (
        channels.map((channel) => {
          const isActive = channel.id === currentChannel?.id;
          return (
            <button
              key={channel.id}
              data-channel-id={channel.id}
              onClick={() => onChannelChange(channel)}
              disabled={isSwitchingSource}
              className={`w-full p-3 rounded-lg text-left transition-all duration-200 ${
                isSwitchingSource
                  ? 'opacity-50 cursor-not-allowed'
                  : isActive
                    ? 'bg-accent/20 border border-accent/40 font-semibold text-accent'
                    : 'hover:bg-zinc-100 dark:hover:bg-zinc-700'
              }`}
            >
              <div className='flex items-center gap-3'>
                <div className='w-10 h-10 bg-zinc-300 dark:bg-zinc-700 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden'>
                  {channel.logo ? (
                    <img
                      src={buildLiveLogoProxyUrl(channel.logo, sourceKey)}
                      alt={channel.name}
                      className='w-full h-full rounded object-contain'
                      loading='lazy'
                      referrerPolicy='no-referrer'
                    />
                  ) : (
                    <Tv className='w-5 h-5 text-zinc-500' />
                  )}
                </div>
                <div className='flex-1 min-w-0'>
                  <div
                    className='text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate'
                    title={channel.name}
                  >
                    {channel.name}
                  </div>
                  <div
                    className='text-xs text-zinc-500 dark:text-zinc-400 mt-1'
                    title={channel.group}
                  >
                    {channel.group}
                  </div>
                </div>
              </div>
            </button>
          );
        })
      ) : (
        <div className='flex flex-col items-center justify-center py-12 text-center'>
          <div className='w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4'>
            <Tv className='w-8 h-8 text-zinc-400 dark:text-zinc-600' />
          </div>
          <p className='text-zinc-500 dark:text-zinc-400 font-medium'>
            暫無可用頻道
          </p>
          <p className='text-sm text-zinc-400 dark:text-zinc-500 mt-1'>
            請選擇其他直播源或稍後再試
          </p>
        </div>
      )}
    </div>
  );
}

/** 直播源清單（直播源 Tab 內容） */
export function LiveSourceList({
  sources,
  currentSource,
  onSourceChange,
}: {
  sources: LiveSource[];
  currentSource: LiveSource | null;
  onSourceChange: (source: LiveSource) => void;
}) {
  return (
    <div className='flex flex-col h-full mt-4'>
      <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
        {sources.length > 0 ? (
          sources.map((source) => {
            const isCurrentSource = source.key === currentSource?.key;
            return (
              <div
                key={source.key}
                onClick={() => !isCurrentSource && onSourceChange(source)}
                className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                  ${
                    isCurrentSource
                      ? 'bg-accent/10 dark:bg-accent/20 border-accent/30 border'
                      : 'hover:bg-zinc-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                  }`.trim()}
              >
                {/* 圖標 */}
                <div className='w-12 h-12 bg-zinc-200 dark:bg-zinc-600 rounded-lg flex items-center justify-center flex-shrink-0'>
                  <Radio className='w-6 h-6 text-zinc-500' />
                </div>

                {/* 資訊 */}
                <div className='flex-1 min-w-0'>
                  <div className='text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate'>
                    {source.name}
                  </div>
                  <div className='text-xs text-zinc-500 dark:text-zinc-400 mt-1'>
                    {!source.channelNumber || source.channelNumber === 0
                      ? '-'
                      : `${source.channelNumber} 個頻道`}
                  </div>
                </div>

                {/* 當前標識 */}
                {isCurrentSource && (
                  <div className='absolute top-2 right-2 w-2 h-2 bg-accent rounded-full'></div>
                )}
              </div>
            );
          })
        ) : (
          <div className='flex flex-col items-center justify-center py-12 text-center'>
            <div className='w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4'>
              <Radio className='w-8 h-8 text-zinc-400 dark:text-zinc-600' />
            </div>
            <p className='text-zinc-500 dark:text-zinc-400 font-medium'>
              暫無可用直播源
            </p>
            <p className='text-sm text-zinc-400 dark:text-zinc-500 mt-1'>
              請檢查網路連接或聯繫管理員新增直播源
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
