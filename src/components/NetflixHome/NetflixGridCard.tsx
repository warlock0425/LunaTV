'use client';

import { useRouter } from 'next/navigation';

import { buildPlayUrl } from '@/lib/play-url';
import { DoubanItem } from '@/lib/types';

import { PosterImage } from './PosterImage';

export function NetflixGridCard({ item }: { item: DoubanItem }) {
  const router = useRouter();

  return (
    <button
      onClick={() =>
        router.push(
          buildPlayUrl({
            title: item.title,
            year: item.year,
            prefer: true,
          })
        )
      }
      className='group relative aspect-[2/3] rounded-lg overflow-hidden cursor-pointer bg-zinc-800 text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-white/50'
    >
      <PosterImage
        src={item.poster}
        title={item.title}
        className='object-cover transition-all duration-300 group-hover:scale-[1.03]'
      />
      <div className='absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all' />
      <div className='absolute inset-0 border border-transparent group-hover:border-white/50 rounded-lg transition-all' />
      {item.rate && (
        <div className='absolute top-2 right-2 rounded-full bg-zinc-800 px-2 py-1 text-xs font-bold text-white shadow-md backdrop-blur-sm'>
          ★ {item.rate}
        </div>
      )}
      {/* 標題遮罩與 VideoCard 一致：實心黑起始 + 較長的漸層過渡，
          避免花俏海報（本身就有大字設計）讓標題糊成一團 */}
      <div className='absolute inset-x-0 bottom-0 px-2.5 pt-6 pb-2 bg-gradient-to-t from-black via-black/80 to-transparent'>
        <p className='text-white text-sm font-medium line-clamp-2 drop-shadow-md'>
          {item.title}
        </p>
        {item.year && <p className='text-zinc-300 text-xs mt-1'>{item.year}</p>}
      </div>
    </button>
  );
}
