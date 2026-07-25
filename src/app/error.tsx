'use client';

import { Home, RefreshCcw } from 'lucide-react';
import Link from 'next/link';

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className='flex min-h-screen items-center justify-center bg-zinc-50 p-6 text-zinc-900 dark:bg-deep dark:text-zinc-100'>
      <section className='w-full max-w-md text-center'>
        <h1 className='text-2xl font-semibold'>頁面暫時無法顯示</h1>
        <p className='mt-3 text-sm text-zinc-600 dark:text-zinc-400'>
          可以重新載入這個頁面，或先返回首頁再試一次。
        </p>
        <div className='mt-6 flex flex-wrap justify-center gap-3'>
          <button
            type='button'
            onClick={reset}
            className='inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-deep'
          >
            <RefreshCcw className='h-4 w-4' aria-hidden='true' />
            重新載入
          </button>
          <Link
            href='/'
            className='inline-flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900'
          >
            <Home className='h-4 w-4' aria-hidden='true' />
            返回首頁
          </Link>
        </div>
      </section>
    </main>
  );
}
