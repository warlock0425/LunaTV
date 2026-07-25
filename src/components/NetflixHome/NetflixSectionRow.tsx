/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';

import { buildPlayUrl } from '@/lib/play-url';
import { DoubanItem } from '@/lib/types';

import { NetflixScrollCard } from './NetflixScrollCard';
import { SectionTitle } from './SectionTitle';

export function NetflixSectionRow({
  title,
  icon,
  items,
  viewAllHref,
  scrollRow,
}: {
  title: string;
  icon: React.ReactNode;
  items: DoubanItem[];
  viewAllHref?: string;
  scrollRow: (
    ref: React.RefObject<HTMLDivElement>,
    dir: 'left' | 'right'
  ) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  return (
    <section className='mb-10'>
      <SectionTitle title={title} icon={icon} viewAllHref={viewAllHref} />
      <div className='relative'>
        {/* 改用 button：原本是 <div onClick>，鍵盤使用者完全無法觸發，
            螢幕閱讀器也不會announce 成可操作元件 */}
        <button
          type='button'
          aria-label='向左捲動'
          onClick={(e) => {
            e.stopPropagation();
            scrollRow(scrollRef as any, 'left');
          }}
          className='absolute left-0 top-0 hidden h-full w-14 items-center justify-center bg-gradient-to-r from-white/85 to-transparent dark:from-black/55 transition-all duration-200 z-50 cursor-pointer md:flex'
        >
          <span className='w-10 h-10 rounded-full bg-white text-zinc-900 flex items-center justify-center font-black shadow-lg ring-1 ring-zinc-200 dark:ring-0'>
            <ChevronLeft className='w-6 h-6' />
          </span>
        </button>
        <button
          type='button'
          aria-label='向右捲動'
          onClick={(e) => {
            e.stopPropagation();
            scrollRow(scrollRef as any, 'right');
          }}
          className='absolute right-0 top-0 hidden h-full w-14 items-center justify-center bg-gradient-to-l from-white/85 to-transparent dark:from-black/55 transition-all duration-200 z-50 cursor-pointer md:flex'
        >
          <span className='w-10 h-10 rounded-full bg-white text-zinc-900 flex items-center justify-center font-black shadow-lg ring-1 ring-zinc-200 dark:ring-0'>
            <ChevronRight className='w-6 h-6' />
          </span>
        </button>
        <div
          ref={scrollRef}
          className='flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth flex-nowrap no-scrollbar py-6 px-2 relative scroll-px-2'
        >
          {items.map((item, idx) => (
            <NetflixScrollCard
              key={`${item.id}-${idx}`}
              item={item}
              onClick={() =>
                router.push(
                  buildPlayUrl({
                    title: item.title,
                    year: item.year,
                    prefer: true,
                  })
                )
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}
