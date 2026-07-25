'use client';

import { Search } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  BangumiCalendarData,
  GetBangumiCalendarData,
} from '@/lib/bangumi.client';
import type { PlayRecord } from '@/lib/db.client';
import { getAllPlayRecords, subscribeToDataUpdates } from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import NetflixHome from './NetflixHomeMain';
import { SkeletonRow } from './Skeletons';
// Internal shared imports
import { deduplicatePlayRecords } from './utils';

export function NetflixHomePage() {
  const searchParams = useSearchParams();
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [bangumiData, setBangumiData] = useState<BangumiCalendarData[]>([]);
  const [playRecords, setPlayRecords] = useState<
    (PlayRecord & { key: string })[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      // 使用 allSettled 避免單一請求失敗導致全部資料為空
      const results = await Promise.allSettled([
        getDoubanCategories({
          kind: 'movie',
          category: '熱門',
          type: '全部',
        }),
        getDoubanCategories({
          kind: 'tv',
          category: 'tv',
          type: 'tv',
        }),
        getDoubanCategories({
          kind: 'tv',
          category: 'show',
          type: 'show',
        }),
        GetBangumiCalendarData(),
        getAllPlayRecords(),
      ]);

      const [
        moviesResult,
        tvResult,
        varietyResult,
        bangumiResult,
        recordsResult,
      ] = results;

      if (
        moviesResult.status === 'fulfilled' &&
        moviesResult.value.code === 200
      )
        setHotMovies(moviesResult.value.list);
      if (tvResult.status === 'fulfilled' && tvResult.value.code === 200)
        setHotTvShows(tvResult.value.list);
      if (
        varietyResult.status === 'fulfilled' &&
        varietyResult.value.code === 200
      )
        setHotVarietyShows(varietyResult.value.list);
      if (bangumiResult.status === 'fulfilled')
        setBangumiData(bangumiResult.value);
      if (recordsResult.status === 'fulfilled')
        setPlayRecords(deduplicatePlayRecords(recordsResult.value));

      setLoading(false);
    };
    fetchData();
  }, []);

  useEffect(() => {
    const handleUpdate = (records: Record<string, PlayRecord>) => {
      setPlayRecords(deduplicatePlayRecords(records || {}));
    };

    const unsubscribe = subscribeToDataUpdates<Record<string, PlayRecord>>(
      'playRecordsUpdated',
      handleUpdate
    );
    return () => {
      unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className='min-h-screen bg-slate-50 dark:bg-surface-page pb-20 pt-20 md:pt-28'>
        {/* Hero Section Skeleton */}
        <div className='w-full h-[50vh] md:h-[70vh] bg-zinc-200 dark:bg-zinc-800/40 animate-pulse mb-12 relative rounded-b-3xl md:rounded-b-[3rem] overflow-hidden'>
          <div className='absolute bottom-10 left-4 md:left-12 flex flex-col gap-4 w-full md:w-1/2'>
            <div className='h-10 md:h-14 w-2/3 bg-zinc-300 dark:bg-zinc-700/50 rounded animate-pulse' />
            <div className='h-4 w-3/4 bg-zinc-300 dark:bg-zinc-700/50 rounded animate-pulse mt-2' />
            <div className='h-4 w-1/2 bg-zinc-300 dark:bg-zinc-700/50 rounded animate-pulse' />
            <div className='flex gap-3 mt-4'>
              <div className='h-10 md:h-12 w-32 rounded-full bg-zinc-300 dark:bg-zinc-700/50 animate-pulse' />
              <div className='h-10 md:h-12 w-32 rounded-full bg-zinc-300 dark:bg-zinc-700/50 animate-pulse' />
            </div>
          </div>
        </div>
        <SkeletonRow title='繼續觀看' />
        <SkeletonRow title='熱門電影' />
        <SkeletonRow title='熱門劇集' />
      </div>
    );
  }

  if (
    hotMovies.length === 0 &&
    hotTvShows.length === 0 &&
    hotVarietyShows.length === 0 &&
    bangumiData.length === 0 &&
    playRecords.length === 0 &&
    searchParams.get('tab') !== 'favorites'
  ) {
    return (
      <div className='min-h-screen bg-slate-50 dark:bg-surface-page flex flex-col items-center justify-center p-6'>
        <div className='flex flex-col items-center gap-6 max-w-md text-center bg-white dark:bg-zinc-900/50 p-8 rounded-3xl shadow-xl border border-zinc-200 dark:border-zinc-800'>
          <div className='w-20 h-20 bg-red-100 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-2'>
            <Search className='w-10 h-10 text-accent' />
          </div>
          <h2 className='text-2xl font-bold text-zinc-900 dark:text-white'>
            暫時無法取得首頁資料
          </h2>
          <p className='text-zinc-500 dark:text-zinc-400 leading-relaxed'>
            上游伺服器可能正在維護或網路連線不穩，您可以稍後再試，或是直接使用搜尋功能尋找想看的影視。
          </p>
          <button
            onClick={() => window.location.reload()}
            className='mt-4 px-8 py-3 bg-accent hover:bg-accent-deep text-white rounded-full font-medium transition-all hover:scale-105 active:scale-95 flex items-center gap-2'
          >
            重新整理
          </button>
        </div>
      </div>
    );
  }

  return (
    <NetflixHome
      hotMovies={hotMovies}
      hotTvShows={hotTvShows}
      hotVarietyShows={hotVarietyShows}
      bangumiData={bangumiData}
      playRecords={playRecords}
    />
  );
}
