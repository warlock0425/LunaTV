/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';

export function SectionTitle({
  title,
  icon,
  viewAllHref,
}: {
  title: string;
  icon: React.ReactNode;
  viewAllHref?: string;
}) {
  return (
    <div className='flex items-center justify-between mb-5'>
      <div className='flex items-center gap-3'>
        {icon}
        <h3 className='text-xl font-bold text-zinc-900 dark:text-white'>
          {title}
        </h3>
      </div>
      {viewAllHref && (
        <Link
          href={viewAllHref}
          className='flex items-center text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors gap-1'
        >
          查看更多 <ChevronRight className='w-4 h-4' />
        </Link>
      )}
    </div>
  );
}
