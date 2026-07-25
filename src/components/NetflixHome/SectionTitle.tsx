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
          // 補上內距把可點區域從 76x20 拉到約 92x40（負 margin 抵銷，版面不變），
          // 以符合觸控目標的最小尺寸建議
          className='-my-2 -mr-2 flex items-center gap-1 px-2 py-2.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
        >
          查看更多 <ChevronRight className='w-4 h-4' />
        </Link>
      )}
    </div>
  );
}
