/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { ChevronLeft, ChevronRight, Clapperboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';

import { BangumiCalendarData } from '@/lib/bangumi.client';
import { buildPlayUrl } from '@/lib/play-url';

import { PosterImage } from './PosterImage';
import { SectionTitle } from './SectionTitle';

export function NetflixBangumiRow({
  bangumiData,
  scrollRow,
}: {
  bangumiData: BangumiCalendarData[];
  scrollRow: (
    ref: React.RefObject<HTMLDivElement>,
    dir: 'left' | 'right'
  ) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const today = new Date();
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const todayKey = weekdays[today.getDay()];
  const todayAnimes =
    bangumiData.find((d) => d.weekday.en === todayKey)?.items || [];

  if (todayAnimes.length === 0) return null;

  return (
    <section className='mb-10'>
      <SectionTitle
        title='今日新番'
        icon={<Clapperboard className='w-5 h-5 text-accent' />}
        viewAllHref='/douban?type=anime'
      />
      <div className='relative'>
        <button
          type='button'
          aria-label='向左捲動'
          onClick={() => scrollRow(scrollRef as any, 'left')}
          className='absolute left-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-lg ring-1 ring-zinc-200 backdrop-blur-sm transition-colors hover:bg-white dark:bg-black/65 dark:text-white dark:ring-0 dark:hover:bg-black/85 md:flex'
        >
          <ChevronLeft className='w-5 h-5' />
        </button>
        <button
          type='button'
          aria-label='向右捲動'
          onClick={() => scrollRow(scrollRef as any, 'right')}
          className='absolute right-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-lg ring-1 ring-zinc-200 backdrop-blur-sm transition-colors hover:bg-white dark:bg-black/65 dark:text-white dark:ring-0 dark:hover:bg-black/85 md:flex'
        >
          <ChevronRight className='w-5 h-5' />
        </button>
        <div
          ref={scrollRef}
          className='flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth scrollbar-hide pb-2 scroll-px-2'
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
          {todayAnimes.map((anime, idx) => (
            <button
              key={`${anime.id}-${idx}`}
              onClick={() => {
                const animeTitle = anime.name_cn || anime.name;
                const animeYear = anime.air_date
                  ? anime.air_date.split('-')[0]
                  : '';
                router.push(
                  buildPlayUrl({
                    title: animeTitle,
                    year: animeYear,
                    stype: 'tv',
                    bgmId: anime.id,
                    stitle:
                      anime.name && anime.name !== anime.name_cn
                        ? anime.name
                        : undefined,
                  })
                );
              }}
              className='group flex flex-col flex-shrink-0 snap-start w-44 cursor-pointer text-left outline-none transition-shadow'
            >
              <div className='relative aspect-[2/3] w-full rounded-md overflow-hidden bg-zinc-800 transition-all border border-transparent group-hover:border-accent/80 shadow-sm'>
                <PosterImage
                  src={
                    anime.images?.large ||
                    anime.images?.common ||
                    anime.images?.medium ||
                    anime.images?.small ||
                    anime.images?.grid
                  }
                  title={anime.name_cn || anime.name}
                  className='object-cover transition-transform duration-300 group-hover:scale-[1.03]'
                />

                <div className='absolute top-2 right-2 text-white/90 hover:text-white transition-colors z-10'>
                  <svg
                    className='w-5 h-5 drop-shadow-md'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    strokeWidth='2'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                  >
                    <path d='M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' />
                  </svg>
                </div>

                <div className='absolute inset-x-0 bottom-0 p-2 pt-8 bg-gradient-to-t from-black via-black/80 to-transparent flex justify-between items-end'>
                  <div className='flex gap-1'></div>
                  {anime.rating?.score && (
                    <div className='flex items-center gap-1 text-white text-[11px] font-medium drop-shadow-md'>
                      <svg
                        className='w-3 h-3 drop-shadow-md'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='2'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      >
                        <path d='M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z' />
                        <circle cx='12' cy='12' r='3' />
                      </svg>
                      {anime.rating.score.toFixed(1)}萬
                    </div>
                  )}
                </div>
              </div>

              <h3 className='text-white text-[14px] font-medium line-clamp-1 group-hover:text-accent transition-colors mt-2 tracking-wide'>
                {anime.name_cn || anime.name}
              </h3>

              <div className='flex items-center justify-between w-full mt-1'>
                <span className='text-zinc-400 text-[12px] font-semibold tracking-wide'>
                  {anime.air_date
                    ? `年份：${anime.air_date.split('-')[0]}`
                    : '年份：未知'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
