'use client';

import { RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export function PwaRegister() {
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production' ||
      !('serviceWorker' in navigator)
    ) {
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          // updateViaCache: 'none' 確保 sw.js 更新不被 HTTP 快取卡住
          updateViaCache: 'none',
        });

        // 上次載入時已有等待中的新版本
        if (registration.waiting && navigator.serviceWorker.controller) {
          setUpdateReady(true);
        }

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            // 有舊 controller 才代表「更新」；首次安裝不提示
            if (
              worker.state === 'activated' &&
              navigator.serviceWorker.controller
            ) {
              setUpdateReady(true);
            }
          });
        });
      } catch {
        // PWA registration is best-effort and must never block the application.
      }
    };
    // hydration 可能晚於 load 事件完成，此時 load 已錯過、必須直接註冊
    if (document.readyState === 'complete') {
      void register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  if (!updateReady || dismissed) return null;

  return (
    <div className='fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-3 px-5 py-3.5 bg-black/80 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl text-white'>
      <RefreshCw className='w-5 h-5 text-sky-400 shrink-0' />
      <p className='text-[15px] font-medium tracking-wide whitespace-nowrap'>
        新版本已就緒
      </p>
      <button
        onClick={() => window.location.reload()}
        className='shrink-0 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 text-sm font-semibold hover:opacity-90 transition-opacity'
      >
        重新整理
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label='暫時關閉'
        className='text-zinc-400 hover:text-white transition-colors'
      >
        <X className='w-4 h-4' />
      </button>
    </div>
  );
}
