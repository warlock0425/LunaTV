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
      {/* HD 標籤移至左上：標題改為常駐後，左下角已被標題遮罩佔用 */}
      <div className='absolute top-2 left-2'>
        <span className='px-2 py-1 bg-black/70 backdrop-blur-sm text-white text-xs font-medium rounded flex items-center gap-1'>
          <Sparkles className='w-3 h-3' /> HD
        </span>
      </div>
      {item.rate && (
        <div className='absolute top-2 right-2 rounded-full bg-zinc-800 px-2 py-1 text-xs font-bold text-white shadow-md backdrop-blur-sm'>
          ★ {item.rate}
        </div>
      )}
      {/* 標題常駐顯示：原本以 hover 滑入，觸控裝置沒有 hover，
          等於手機上永遠看不到片名。遮罩與 VideoCard 一致。 */}
      <div className='absolute inset-x-0 bottom-0 px-2.5 pt-6 pb-2 bg-gradient-to-t from-black via-black/80 to-transparent'>
        <p className='text-white text-sm font-medium line-clamp-2 drop-shadow-md'>
          {item.title}
        </p>
        {item.year && <p className='text-zinc-300 text-xs mt-1'>{item.year}</p>}
      </div>
    </button>
  );
}
