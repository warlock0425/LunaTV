/* eslint-disable react-hooks/exhaustive-deps */

import { Clock, Target, Tv } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { formatTimeToHHMM, parseCustomTimeFormat } from '@/lib/time';

interface EpgProgram {
  start: string;
  end: string;
  title: string;
}

interface EpgScrollableRowProps {
  programs: EpgProgram[];
  currentTime?: Date;
  isLoading?: boolean;
}

export default function EpgScrollableRow({
  programs,
  currentTime = new Date(),
  isLoading = false,
}: EpgScrollableRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState<number>(-1);

  // 處理滾輪事件，實現橫向滾動
  const handleWheel = (e: WheelEvent) => {
    if (isHovered && containerRef.current) {
      e.preventDefault(); // 阻止預設的豎向滾動

      const container = containerRef.current;
      const scrollAmount = e.deltaY * 4; // 增加滾動速度

      // 根據滾輪方向進行橫向滾動
      container.scrollBy({
        left: scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  // 阻止頁面豎向滾動
  const preventPageScroll = (e: WheelEvent) => {
    if (isHovered) {
      e.preventDefault();
    }
  };

  // 判斷節目是否正在播放（需宣告於使用之前）
  const isCurrentlyPlaying = (program: EpgProgram, now: Date = currentTime) => {
    try {
      const start = parseCustomTimeFormat(program.start);
      const end = parseCustomTimeFormat(program.end);
      return now >= start && now < end;
    } catch {
      return false;
    }
  };

  // 自動滾動到正在播放的節目
  const scrollToCurrentProgram = (now: Date = currentTime) => {
    if (containerRef.current) {
      const currentProgramIndex = programs.findIndex((program) =>
        isCurrentlyPlaying(program, now)
      );
      if (currentProgramIndex !== -1) {
        const programElement = containerRef.current.children[
          currentProgramIndex
        ] as HTMLElement;
        if (programElement) {
          const container = containerRef.current;
          const programLeft = programElement.offsetLeft;
          const containerWidth = container.clientWidth;
          const programWidth = programElement.offsetWidth;

          // 計算滾動位置，使正在播放的節目居中顯示
          const scrollLeft =
            programLeft - containerWidth / 2 + programWidth / 2;

          container.scrollTo({
            left: Math.max(0, scrollLeft),
            behavior: 'smooth',
          });
        }
      }
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (isHovered) {
      // 滑鼠懸停在元件容器內時，阻止容器外的預設滾動，並進行橫向滾動
      container.addEventListener('wheel', preventPageScroll, {
        passive: false,
      });
      container.addEventListener('wheel', handleWheel, { passive: false });
    } else {
      container.removeEventListener('wheel', preventPageScroll);
      container.removeEventListener('wheel', handleWheel);
    }

    return () => {
      container.removeEventListener('wheel', preventPageScroll);
      container.removeEventListener('wheel', handleWheel);
    };
  }, [isHovered]);

  // 組件載入後自動滾動到正在播放的節目
  useEffect(() => {
    // 延遲執行，確保DOM完全渲染
    const timer = setTimeout(() => {
      // 初始化當前正在播放的節目索引
      const initialPlayingIndex = programs.findIndex((program) =>
        isCurrentlyPlaying(program)
      );
      setCurrentPlayingIndex(initialPlayingIndex);
      scrollToCurrentProgram();
    }, 100);

    return () => clearTimeout(timer);
  }, [programs, currentTime]);

  // 定時重新整理正在播放狀態
  useEffect(() => {
    // 每分鐘重新整理一次正在播放狀態
    const interval = setInterval(() => {
      const now = new Date();
      // 更新當前正在播放的節目索引
      const newPlayingIndex = programs.findIndex((program) => {
        try {
          const start = parseCustomTimeFormat(program.start);
          const end = parseCustomTimeFormat(program.end);
          return now >= start && now < end;
        } catch {
          return false;
        }
      });

      if (newPlayingIndex !== currentPlayingIndex) {
        setCurrentPlayingIndex(newPlayingIndex);
        // 如果正在播放的節目發生變化，自動滾動到新位置
        scrollToCurrentProgram(now);
      }
    }, 60000); // 60秒 = 1分鐘

    return () => clearInterval(interval);
  }, [programs, currentTime, currentPlayingIndex]);

  // 格式化時間顯示
  const formatTime = (timeString: string) => {
    return formatTimeToHHMM(timeString);
  };

  // 判斷節目是否正在播放

  // 載入中狀態
  if (isLoading) {
    return (
      <div className='pt-4'>
        <div className='mb-3 flex items-center justify-between'>
          <h4 className='text-xs sm:text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2'>
            <Clock className='w-3 h-3 sm:w-4 sm:h-4' />
            今日節目單
          </h4>
          <div className='w-16 sm:w-20'></div>
        </div>
        <div className='min-h-[100px] sm:min-h-[120px] flex items-center justify-center'>
          <div className='flex items-center gap-3 sm:gap-4 text-zinc-500 dark:text-zinc-400'>
            <div className='w-5 h-5 sm:w-6 sm:h-6 border-2 border-zinc-300 border-t-blue-500 rounded-full animate-spin'></div>
            <span className='text-sm sm:text-base'>載入節目單...</span>
          </div>
        </div>
      </div>
    );
  }

  // 無節目單狀態
  if (!programs || programs.length === 0) {
    return (
      <div className='pt-4'>
        <div className='mb-3 flex items-center justify-between'>
          <h4 className='text-xs sm:text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2'>
            <Clock className='w-3 h-3 sm:w-4 sm:h-4' />
            今日節目單
          </h4>
          <div className='w-16 sm:w-20'></div>
        </div>
        <div className='min-h-[100px] sm:min-h-[120px] flex items-center justify-center'>
          <div className='flex items-center gap-2 sm:gap-3 text-zinc-400 dark:text-zinc-500'>
            <Tv className='w-4 h-4 sm:w-5 sm:h-5' />
            <span className='text-sm sm:text-base'>暫無節目單資料</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='pt-4 mt-2'>
      <div className='mb-3 flex items-center justify-between'>
        <h4 className='text-xs sm:text-sm font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-2'>
          <Clock className='w-3 h-3 sm:w-4 sm:h-4' />
          今日節目單
        </h4>
        {currentPlayingIndex !== -1 && (
          <button
            onClick={() => scrollToCurrentProgram()}
            className='flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 sm:py-2 text-xs font-medium text-zinc-600 dark:text-zinc-400 hover:text-green-600 dark:hover:text-green-400 bg-zinc-300/50 dark:bg-zinc-800 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-green-300 dark:hover:border-green-700 transition-all duration-200'
            title='滾動到當前播放位置'
          >
            <Target className='w-2.5 h-2.5 sm:w-3 sm:h-3' />
            <span className='hidden sm:inline'>當前播放</span>
            <span className='sm:hidden'>當前</span>
          </button>
        )}
      </div>

      <div
        className='relative'
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          ref={containerRef}
          className='flex overflow-x-auto scrollbar-hide py-2 pb-4 px-2 sm:px-4 min-h-[100px] sm:min-h-[120px]'
        >
          {programs.map((program, index) => {
            // 使用 currentPlayingIndex 來判斷播放狀態，確保樣式能正確更新
            const isPlaying = index === currentPlayingIndex;
            const isFinishedProgram = index < currentPlayingIndex;
            const isUpcomingProgram = index > currentPlayingIndex;

            return (
              <div
                key={index}
                className={`flex-shrink-0 w-36 sm:w-48 p-2 sm:p-3 rounded-lg border transition-all duration-200 flex flex-col min-h-[100px] sm:min-h-[120px] ${
                  isPlaying
                    ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30'
                    : isFinishedProgram
                      ? 'bg-zinc-300/50 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700'
                      : isUpcomingProgram
                        ? 'bg-blue-500/10 dark:bg-blue-500/20 border-blue-500/30'
                        : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                }`}
              >
                {/* 時間顯示在頂部 */}
                <div className='flex items-center justify-between mb-2 sm:mb-3 flex-shrink-0'>
                  <span
                    className={`text-xs font-medium ${
                      isPlaying
                        ? 'text-green-600 dark:text-green-400'
                        : isFinishedProgram
                          ? 'text-zinc-500 dark:text-zinc-400'
                          : isUpcomingProgram
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-zinc-600 dark:text-zinc-300'
                    }`}
                  >
                    {formatTime(program.start)}
                  </span>
                  <span className='text-xs text-zinc-400 dark:text-zinc-500'>
                    {formatTime(program.end)}
                  </span>
                </div>

                {/* 標題在中間，占據賸餘空間 */}
                <div
                  className={`text-xs sm:text-sm font-medium flex-1 ${
                    isPlaying
                      ? 'text-green-900 dark:text-green-100'
                      : isFinishedProgram
                        ? 'text-zinc-600 dark:text-zinc-400'
                        : isUpcomingProgram
                          ? 'text-blue-900 dark:text-blue-100'
                          : 'text-zinc-900 dark:text-zinc-100'
                  }`}
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: '1.4',
                    maxHeight: '2.8em',
                  }}
                  title={program.title}
                >
                  {program.title}
                </div>

                {/* 正在播放狀態在底部 */}
                {isPlaying && (
                  <div className='mt-auto pt-1 sm:pt-2 flex items-center gap-1 sm:gap-1.5 flex-shrink-0'>
                    <div className='w-1.5 h-1.5 sm:w-2 sm:h-2 bg-green-500 rounded-full animate-pulse'></div>
                    <span className='text-xs text-green-600 dark:text-green-400 font-medium'>
                      正在播放
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
