'use client';

export const SkeletonCard = () => (
  <div className='relative aspect-[2/3] w-32 sm:w-40 md:w-48 shrink-0 rounded-lg bg-zinc-200 dark:bg-zinc-800/80 animate-pulse overflow-hidden'>
    <div className='absolute inset-0 bg-gradient-to-r from-transparent via-white/20 dark:via-white/5 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]' />
  </div>
);

export const SkeletonRow = ({ title: _title }: { title: string }) => (
  <section className='mb-10 px-4 md:px-12'>
    <div className='flex items-center gap-2 mb-4'>
      <div className='w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse' />
      <div className='h-6 w-32 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse' />
    </div>
    <div className='flex gap-3 overflow-hidden'>
      {[...Array(8)].map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  </section>
);
