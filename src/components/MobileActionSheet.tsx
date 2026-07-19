import { Radio, X } from 'lucide-react';
import Image from 'next/image';
import React, { useEffect, useState } from 'react';

interface ActionItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: (e?: React.MouseEvent) => void | Promise<void>;
  color?: 'default' | 'danger' | 'primary';
  disabled?: boolean;
}

interface MobileActionSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  actions: ActionItem[];
  poster?: string;
  sources?: string[]; // 播放源資訊
  isAggregate?: boolean; // 是否為聚合內容
  sourceName?: string; // 播放源名稱
  currentEpisode?: number; // 當前集數
  totalEpisodes?: number; // 總集數
  origin?: 'vod' | 'live';
}

const MobileActionSheet: React.FC<MobileActionSheetProps> = ({
  isOpen,
  onClose,
  title,
  actions,
  poster,
  sources,
  isAggregate,
  sourceName,
  currentEpisode,
  totalEpisodes,
  origin = 'vod',
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  // 關閉時立即停止動畫（render 期調整）
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (!isOpen) setIsAnimating(false);
  }

  // 控製動畫狀態
  useEffect(() => {
    let animationId: number;
    let timer: NodeJS.Timeout;

    if (isOpen) {
      // 首個 rAF 先顯示元件，雙重 rAF 確保 DOM 完全渲染後再啟動過場
      animationId = requestAnimationFrame(() => {
        setIsVisible(true);
        animationId = requestAnimationFrame(() => {
          setIsAnimating(true);
        });
      });
    } else {
      // 等待動畫完成後隱藏組件
      timer = setTimeout(() => {
        setIsVisible(false);
      }, 200);
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isOpen]);

  // 阻止背景滾動
  useEffect(() => {
    if (isVisible) {
      // 儲存當前滾動位置
      const scrollY = window.scrollY;
      const scrollX = window.scrollX;
      const body = document.body;
      const html = document.documentElement;

      // 取得滾動條寬度
      const scrollBarWidth = window.innerWidth - html.clientWidth;

      // 儲存原始樣式
      const originalBodyStyle = {
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width,
        paddingRight: body.style.paddingRight,
        overflow: body.style.overflow,
      };

      // 設置body樣式來阻止滾動，但保持原位置
      body.style.position = 'fixed';
      body.style.top = `-${scrollY}px`;
      body.style.left = `-${scrollX}px`;
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      body.style.paddingRight = `${scrollBarWidth}px`;

      return () => {
        // 恢復所有原始樣式
        body.style.position = originalBodyStyle.position;
        body.style.top = originalBodyStyle.top;
        body.style.left = originalBodyStyle.left;
        body.style.right = originalBodyStyle.right;
        body.style.width = originalBodyStyle.width;
        body.style.paddingRight = originalBodyStyle.paddingRight;
        body.style.overflow = originalBodyStyle.overflow;

        // 使用 requestAnimationFrame 確保樣式恢復後再滾動
        requestAnimationFrame(() => {
          window.scrollTo(scrollX, scrollY);
        });
      };
    }
  }, [isVisible]);

  // ESC鍵關閉
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleEsc);
      return () => document.removeEventListener('keydown', handleEsc);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  const getActionColor = (color: ActionItem['color']) => {
    switch (color) {
      case 'danger':
        return 'text-red-600 dark:text-red-400';
      case 'primary':
        return 'text-green-600 dark:text-green-400';
      default:
        return 'text-zinc-700 dark:text-zinc-300';
    }
  };

  const getActionHoverColor = (color: ActionItem['color']) => {
    switch (color) {
      case 'danger':
        return 'hover:bg-red-50/50 dark:hover:bg-red-900/10';
      case 'primary':
        return 'hover:bg-green-50/50 dark:hover:bg-green-900/10';
      default:
        return 'hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20';
    }
  };

  return (
    <div
      className='fixed inset-0 z-[9999] flex items-end justify-center'
      onTouchMove={(e) => {
        // 阻止最外層容器的觸摸移動，防止背景滾動
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        touchAction: 'none', // 禁用所有觸摸操作
      }}
    >
      {/* 背景遮罩 */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ease-out ${
          isAnimating ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        onTouchMove={(e) => {
          // 只阻止滾動，允許其他觸摸事件（包括點擊）
          e.preventDefault();
        }}
        onWheel={(e) => {
          // 阻止滾輪滾動
          e.preventDefault();
        }}
        style={{
          backdropFilter: 'blur(4px)',
          willChange: 'opacity',
          touchAction: 'none', // 禁用所有觸摸操作
        }}
      />

      {/* 操作表單 */}
      <div
        className='relative w-full max-w-lg mx-4 mb-4 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl transition-all duration-200 ease-out'
        onTouchMove={(e) => {
          // 允許操作表單內部滾動，阻止事件冒泡到外層
          e.stopPropagation();
        }}
        style={{
          marginBottom: 'calc(1rem + env(safe-area-inset-bottom))',
          willChange: 'transform, opacity',
          backfaceVisibility: 'hidden', // 避免閃爍
          transform: isAnimating
            ? 'translateY(0) translateZ(0)'
            : 'translateY(100%) translateZ(0)', // 組合變換保持滑入效果和硬件加速
          opacity: isAnimating ? 1 : 0,
          touchAction: 'auto', // 允許操作表單內的正常觸摸操作
        }}
      >
        {/* 頭部 */}
        <div className='flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800'>
          <div className='flex items-center gap-3 flex-1 min-w-0'>
            {poster && (
              <div className='relative w-12 h-16 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 flex-shrink-0'>
                <Image
                  src={poster}
                  alt={title}
                  fill
                  className={
                    origin === 'live' ? 'object-contain' : 'object-cover'
                  }
                  loading='lazy'
                />
              </div>
            )}
            <div className='min-w-0 flex-1'>
              <div className='flex items-center gap-2 mb-1'>
                <h3 className='text-lg font-semibold text-zinc-900 dark:text-zinc-100 truncate'>
                  {title}
                </h3>
                {sourceName && (
                  <span className='flex-shrink-0 text-xs px-2.5 py-1 border border-zinc-400 dark:border-zinc-600 rounded text-zinc-700 dark:text-zinc-200 bg-white/90 dark:bg-zinc-900/80 font-medium shadow-sm'>
                    {origin === 'live' && (
                      <Radio
                        size={12}
                        className='inline-block text-zinc-700 dark:text-zinc-200 mr-1.5'
                      />
                    )}
                    {sourceName}
                  </span>
                )}
              </div>
              <p className='text-sm text-zinc-600 dark:text-zinc-300 font-medium'>
                選擇操作
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className='p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors duration-150'
          >
            <X size={20} className='text-zinc-500 dark:text-zinc-400' />
          </button>
        </div>

        {/* 操作列表 */}
        <div className='px-4 py-2'>
          {actions.map((action, index) => (
            <div key={action.id}>
              <button
                onClick={() => {
                  action.onClick();
                  onClose();
                }}
                disabled={action.disabled}
                className={`
                  w-full flex items-center gap-4 py-4 px-2 transition-all duration-150 ease-out
                  ${
                    action.disabled
                      ? 'opacity-50 cursor-not-allowed'
                      : `${getActionHoverColor(
                          action.color
                        )} active:scale-[0.98]`
                  }
                `}
                style={{ willChange: 'transform, background-color' }}
              >
                {/* 圖標 - 使用線條風格 */}
                <div className='w-6 h-6 flex items-center justify-center flex-shrink-0'>
                  <span
                    className={`transition-colors duration-150 ${
                      action.disabled
                        ? 'text-zinc-400 dark:text-zinc-600'
                        : getActionColor(action.color)
                    }`}
                  >
                    {action.icon}
                  </span>
                </div>

                {/* 文字 */}
                <span
                  className={`
                  text-left font-medium text-base flex-1
                  ${
                    action.disabled
                      ? 'text-zinc-400 dark:text-zinc-600'
                      : 'text-zinc-900 dark:text-zinc-100'
                  }
                `}
                >
                  {action.label}
                </span>

                {/* 播放進度 - 只在播放按鈕且有播放記錄時顯示 */}
                {action.id === 'play' && currentEpisode && totalEpisodes && (
                  <span className='text-sm text-zinc-700 dark:text-zinc-300 font-medium'>
                    {currentEpisode}/{totalEpisodes}
                  </span>
                )}
              </button>

              {/* 分割線 - 最後一項不顯示 */}
              {index < actions.length - 1 && (
                <div className='border-b border-zinc-100 dark:border-zinc-800 ml-10'></div>
              )}
            </div>
          ))}
        </div>

        {/* 播放源資訊展示區域 */}
        {isAggregate && sources && sources.length > 0 && (
          <div className='px-4 py-3 border-t border-zinc-100 dark:border-zinc-800'>
            {/* 標題區域 */}
            <div className='mb-3'>
              <h4 className='text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-1'>
                可用播放源
              </h4>
              <p className='text-xs text-zinc-600 dark:text-zinc-400 font-medium'>
                共 {sources.length} 個播放源
              </p>
            </div>

            {/* 播放源列表 */}
            <div className='max-h-32 overflow-y-auto'>
              <div className='grid grid-cols-2 gap-2'>
                {sources.map((source, index) => (
                  <div
                    key={index}
                    className='flex items-center gap-2 py-2 px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/30 dark:bg-zinc-800/30'
                  >
                    <div className='w-1 h-1 bg-zinc-400 dark:bg-zinc-500 rounded-full flex-shrink-0' />
                    <span className='text-xs text-zinc-700 dark:text-zinc-300 font-medium truncate'>
                      {source}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MobileActionSheet;
