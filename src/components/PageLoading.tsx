import { LoaderCircle } from 'lucide-react';

export default function PageLoading() {
  return (
    <div
      className='flex min-h-[50vh] items-center justify-center gap-3 text-zinc-500 dark:text-zinc-400'
      role='status'
      aria-live='polite'
    >
      <LoaderCircle className='h-5 w-5 animate-spin' aria-hidden='true' />
      <span className='text-sm'>載入中...</span>
    </div>
  );
}
