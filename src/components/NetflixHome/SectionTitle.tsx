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
    <div className='flex items-center justify-between mb-4 px-0.5'>
      <div className='flex items-center gap-2.5 min-w-0'>
        <span className='text-accent shrink-0'>{icon}</span>
        <h3 className='text-lg sm:text-xl font-bold text-white truncate'>
          {title}
        </h3>
      </div>
      {viewAllHref && (
        <Link
          href={viewAllHref}
          // 補上內距把可點區域從 76x20 拉到約 92x40（負 margin 抵銷，版面不變），
          // 以符合觸控目標的最小尺寸建議
          className='-my-2 -mr-2 flex items-center gap-0.5 px-2 py-2.5 text-sm text-zinc-400 transition-colors hover:text-accent shrink-0'
        >
          查看更多 <ChevronRight className='w-4 h-4' />
        </Link>
      )}
    </div>
  );
}
