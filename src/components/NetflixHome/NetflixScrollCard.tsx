/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
'use client';

import { Sparkles } from 'lucide-react';

import { DoubanItem } from '@/lib/types';

import { PosterImage } from './PosterImage';

export function NetflixScrollCard({
  item,
  onClick,
}: {
  item: DoubanItem;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className='group relative flex-shrink-0 snap-start w-44 aspect-[2/3] rounded-lg overflow-hidden cursor-pointer bg-zinc-800 text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-white/50'
    >
      <PosterImage src={item.poster} title={item.title} />
      <div className='absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-300' />
      <div className='absolute bottom-2 left-2'>
        <span className='px-2 py-1 bg-black/70 backdrop-blur-sm text-white text-xs font-medium rounded flex items-center gap-1'>
          <Sparkles className='w-3 h-3' /> HD
        </span>
      </div>
      {item.rate && (
        <div className='absolute top-2 right-2 rounded-full bg-zinc-800 px-2 py-1 text-xs font-bold text-white shadow-md backdrop-blur-sm'>
          ★ {item.rate}
        </div>
      )}
      <div className='absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 to-transparent translate-y-full group-hover:translate-y-0 transition-transform duration-300'>
        <p className='text-white text-sm font-medium line-clamp-2'>
          {item.title}
        </p>
        {item.year && <p className='text-zinc-300 text-xs mt-1'>{item.year}</p>}
      </div>
    </button>
  );
}
