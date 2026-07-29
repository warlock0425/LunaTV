'use client';

import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismissTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set()
  );

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    const timer = setTimeout(() => {
      dismissTimersRef.current.delete(timer);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
    dismissTimersRef.current.add(timer);
  }, []);

  // 卸載時清掉尚未觸發的自動關閉計時器
  useEffect(() => {
    const timers = dismissTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className='fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none'>
        {toasts.map((t) => (
          <div
            key={t.id}
            className='animate-in slide-in-from-bottom-5 fade-in duration-300 pointer-events-auto flex items-center gap-3 px-5 py-3.5 bg-black/70 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl text-white min-w-[280px]'
          >
            {t.type === 'success' && (
              <CheckCircle2 className='w-5 h-5 text-emerald-400 shrink-0' />
            )}
            {t.type === 'error' && (
              <AlertCircle className='w-5 h-5 text-rose-400 shrink-0' />
            )}
            {t.type === 'info' && (
              <Info className='w-5 h-5 text-sky-400 shrink-0' />
            )}

            <p className='text-[15px] font-medium tracking-wide flex-1'>
              {t.message}
            </p>

            <button
              onClick={() =>
                setToasts((prev) => prev.filter((toast) => toast.id !== t.id))
              }
              className='text-zinc-400 hover:text-white transition-colors'
            >
              <X className='w-4 h-4' />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
