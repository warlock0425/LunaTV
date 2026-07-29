'use client';

import { useEffect, useRef, useState } from 'react';

interface ErrorInfo {
  id: string;
  message: string;
  timestamp: number;
}

export function GlobalErrorIndicator() {
  const [currentError, setCurrentError] = useState<ErrorInfo | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);

  const replaceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 「目前是否已有錯誤」記在 ref 而非讀 state：setState 的 updater 必須是
  // 純函式（React 可能重複呼叫），不能在裡面啟動計時器。
  const hasErrorRef = useRef(false);

  // 依賴刻意留空。原本掛在 [currentError] 上會讓每來一次錯誤就重新註冊一次
  // 監聽，而且替換動畫的計時器沒有人負責清除。
  useEffect(() => {
    const handleError = (event: CustomEvent) => {
      const { message } = event.detail;

      // 已有錯誤時播放替換動畫
      if (hasErrorRef.current) {
        if (replaceTimerRef.current) clearTimeout(replaceTimerRef.current);
        setIsReplacing(true);
        replaceTimerRef.current = setTimeout(() => {
          replaceTimerRef.current = null;
          setIsReplacing(false);
        }, 200);
      }

      hasErrorRef.current = true;
      setCurrentError({
        id: Date.now().toString(),
        message,
        timestamp: Date.now(),
      });
      setIsVisible(true);
    };

    window.addEventListener('globalError', handleError as EventListener);

    return () => {
      window.removeEventListener('globalError', handleError as EventListener);
      if (replaceTimerRef.current) {
        clearTimeout(replaceTimerRef.current);
        replaceTimerRef.current = null;
      }
    };
  }, []);

  const handleClose = () => {
    if (replaceTimerRef.current) {
      clearTimeout(replaceTimerRef.current);
      replaceTimerRef.current = null;
    }
    hasErrorRef.current = false;
    setIsVisible(false);
    setCurrentError(null);
    setIsReplacing(false);
  };

  if (!isVisible || !currentError) {
    return null;
  }

  return (
    <div className='fixed top-4 right-4 z-[2000]'>
      {/* 錯誤卡片 */}
      <div
        className={`bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center justify-between min-w-[300px] max-w-[400px] transition-all duration-300 ${
          isReplacing ? 'scale-105 bg-red-400' : 'scale-100 bg-red-500'
        } animate-fade-in`}
      >
        <span className='text-sm font-medium flex-1 mr-3'>
          {currentError.message}
        </span>
        <button
          onClick={handleClose}
          className='text-white hover:text-red-100 transition-colors flex-shrink-0'
          aria-label='關閉錯誤提示'
        >
          <svg
            className='w-5 h-5'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M6 18L18 6M6 6l12 12'
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
