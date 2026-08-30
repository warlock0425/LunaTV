'use client';

import Link from 'next/link';
import { Component, ReactNode } from 'react';

import { isChunkLoadError, reloadOnceForStaleChunk } from '@/lib/chunk-reload';

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

function isTranslationDomError(error: Error): boolean {
  if (typeof window === 'undefined') return false;
  const msg = error?.message || '';
  const isDomMutationError =
    (msg.includes('removeChild') || msg.includes('insertBefore')) &&
    msg.includes('Node');
  if (!isDomMutationError) return false;
  // 檢查是否處於翻譯狀態（Google / Chrome / Edge 翻譯外掛會給 html 加上 translated 類或注入 <font> 標籤）
  const isTranslated =
    document.documentElement.classList.contains('translated-ltr') ||
    document.documentElement.classList.contains('translated-rtl') ||
    document.querySelector('font') !== null ||
    document.querySelector('.goog-te-banner-frame') !== null;
  return isTranslated;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (isChunkLoadError(error)) {
      void reloadOnceForStaleChunk();
    } else if (isTranslationDomError(error)) {
      // 瀏覽器翻譯外掛修改 DOM 節點導致 React 崩潰時，嘗試自動重載恢復
      void reloadOnceForStaleChunk();
    }
  }

  private handleReload = () => {
    if (
      this.state.error &&
      (isChunkLoadError(this.state.error) ||
        isTranslationDomError(this.state.error))
    ) {
      void reloadOnceForStaleChunk();
      return;
    }
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <main className='flex min-h-screen items-center justify-center bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100'>
          <section className='w-full max-w-md rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900'>
            <h1 className='text-xl font-semibold'>頁面發生錯誤</h1>
            <p className='mt-3 text-sm text-zinc-600 dark:text-zinc-400'>
              請重新整理頁面，或返回首頁後再試一次。
            </p>
            {process.env.NODE_ENV === 'development' && (
              <pre className='mt-4 max-h-40 overflow-auto rounded-md bg-zinc-100 p-3 text-left text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300'>
                {this.state.error.message}
              </pre>
            )}
            <div className='mt-5 flex justify-center gap-3'>
              <button
                type='button'
                onClick={this.handleReload}
                className='rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-deep'
              >
                重新整理
              </button>
              <Link
                href='/'
                className='rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'
              >
                返回首頁
              </Link>
            </div>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
