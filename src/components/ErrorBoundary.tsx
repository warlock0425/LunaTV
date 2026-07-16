'use client';

import Link from 'next/link';
import { Component, ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

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

  private handleReload = () => {
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
                className='rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#cc3256]'
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
