/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
'use client';

import {
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  Clapperboard,
  Film,
  Search,
  Star,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { BangumiCalendarData } from '@/lib/bangumi.client';
import type { PlayRecord } from '@/lib/db.client';
import { clearAllPlayRecords, deletePlayRecord } from '@/lib/db.client';
import {
  deduplicatePlayRecordList,
  hydratePlayRecord,
} from '@/lib/play-records';
import { buildPlayUrl } from '@/lib/play-url';
import { generateStorageKey, parseStorageKey } from '@/lib/storage-key';
import { DoubanItem } from '@/lib/types';
import { useClientValue } from '@/hooks/useClientMount';

import MobileBottomNav from '@/components/MobileBottomNav';
import SearchSuggestions from '@/components/SearchSuggestions';
import Sidebar from '@/components/Sidebar';
import { useSite } from '@/components/SiteProvider';
import { useToast } from '@/components/ToastProvider';
import { UserMenu } from '@/components/UserMenu';

import { ContinueWatchingCover } from './ContinueWatchingCover';
import { FavoritesView } from './FavoritesView';
import { NetflixBangumiRow } from './NetflixBangumiRow';
import { NetflixGridCard } from './NetflixGridCard';
import { NetflixSectionRow } from './NetflixSectionRow';
import { SectionTitle } from './SectionTitle';

export default function NetflixHome({
  hotMovies = [],
  hotTvShows = [],
  hotVarietyShows = [],
  bangumiData = [],
  playRecords = [],
}: {
  hotMovies?: DoubanItem[];
  hotTvShows?: DoubanItem[];
  hotVarietyShows?: DoubanItem[];
  bangumiData?: BangumiCalendarData[];
  playRecords?: (PlayRecord & { key: string })[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams?.get('tab');
  const { announcement } = useSite();
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [activeNav, setActiveNav] = useState<'home' | 'favorites'>('home');
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const { toast } = useToast();

  // 狀態化管理繼續觀看，確保刪除時能即時反應
  const [continueWatching, setContinueWatching] = useState<any[]>(() =>
    playRecords.map((r) => hydratePlayRecord(r))
  );

  // playRecords 變化時重建（render 期調整狀態；刪除等操作仍可本地覆寫）
  const [prevPlayRecords, setPrevPlayRecords] = useState(playRecords);
  if (playRecords !== prevPlayRecords) {
    setPrevPlayRecords(playRecords);
    setContinueWatching(playRecords.map((r) => hydratePlayRecord(r)));
  }

  const handleDelete = async (e: React.MouseEvent, item: any) => {
    e.stopPropagation();
    e.preventDefault();
    if (!item) return;

    try {
      const parsedKey = parseStorageKey(item.key);
      const realSource = parsedKey?.source || item.source;
      const realId = parsedKey?.id || item.id || item.vod_id;

      const targetKey =
        item.key ||
        (realSource && realId ? generateStorageKey(realSource, realId) : '');

      setContinueWatching((prev) =>
        targetKey
          ? prev.filter(
              (c) =>
                (c.key || generateStorageKey(c.source, c.id || c.vod_id)) !==
                targetKey
            )
          : prev
      );

      if (realSource && realId) {
        await deletePlayRecord(realSource, realId, {
          title: item.title || item.vod_name,
          source_name: item.source_name,
        });
      }

      const authInfo = getAuthInfoFromBrowserCookie();
      const userId = authInfo?.username || 'default_user';
      await fetch('/api/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vod_name: item.title || item.vod_name,
          source: realSource,
          source_name: item.source_name,
          userId,
        }),
      }).catch((err) => {
        console.warn('API 歷史刪除失敗:', err);
      });
    } catch (err) {
      console.error('刪除播放記錄錯誤:', err);
    }
  };

  // tab 參數變化時切換導覽（render 期調整狀態）
  const [prevTab, setPrevTab] = useState(tab);
  if (tab !== prevTab) {
    setPrevTab(tab);
    setActiveNav(tab === 'favorites' ? 'favorites' : 'home');
  }

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 公告是否已讀（瀏覽器端一次性讀取）；關閉時以本地覆寫
  const seenAnnouncement = useClientValue(
    () =>
      typeof localStorage === 'undefined'
        ? null
        : localStorage.getItem('hasSeenAnnouncement'),
    null
  );
  const [prevAnnouncement, setPrevAnnouncement] = useState<string | null>(null);
  if (
    announcement &&
    seenAnnouncement !== null &&
    announcement !== prevAnnouncement
  ) {
    setPrevAnnouncement(announcement);
    if (seenAnnouncement !== announcement) setShowAnnouncement(true);
  }

  const handleCloseAnnouncement = useCallback((text: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', text);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      setShowSuggestions(false);
      router.push(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const continueRef = useRef<HTMLDivElement>(null);
  const scrollRow = (
    ref: React.RefObject<HTMLDivElement>,
    dir: 'left' | 'right'
  ) => {
    const width = ref.current?.clientWidth || 400;
    ref.current?.scrollBy({
      left:
        dir === 'left' ? -Math.round(width * 0.85) : Math.round(width * 0.85),
      behavior: 'smooth',
    });
  };

  return (
    <div className='min-h-screen bg-transparent text-zinc-900 dark:text-zinc-100'>
      <div className='hidden md:block'>
        <Sidebar
          activePath={activeNav === 'favorites' ? '/?tab=favorites' : '/'}
        />
      </div>

      <div className='pl-0 md:pl-24'>
        <header
          className={`sticky top-0 z-40 h-16 md:h-20 flex items-center justify-between px-4 md:px-8 transition-all duration-300 ${
            isScrolled
              ? 'bg-white/80 dark:bg-[#040404]/80 backdrop-blur-xl border-b border-zinc-200 dark:border-white/5'
              : 'bg-transparent'
          }`}
        >
          <form onSubmit={handleSearch} className='flex-1 max-w-2xl'>
            <div className='relative'>
              <Search className='absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400' />
              <input
                type='text'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setShowSuggestions(true)}
                placeholder='搜尋電影、電視劇、動漫...'
                className='w-full md:w-96 h-11 pl-12 pr-4 bg-zinc-100 dark:bg-zinc-900/80 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-600 dark:placeholder-zinc-300 border border-zinc-200 dark:border-white/10 focus:border-accent focus:outline-none transition-all duration-200'
              />
              <SearchSuggestions
                query={searchQuery}
                isVisible={showSuggestions}
                onSelect={(suggestion) => {
                  setSearchQuery(suggestion);
                  setShowSuggestions(false);
                  router.push(`/search?q=${encodeURIComponent(suggestion)}`);
                }}
                onClose={() => setShowSuggestions(false)}
                onEnterKey={() => {
                  if (searchQuery.trim()) {
                    setShowSuggestions(false);
                    router.push(
                      `/search?q=${encodeURIComponent(searchQuery.trim())}`
                    );
                  }
                }}
              />
            </div>
          </form>
          <div className='flex items-center gap-3 md:gap-6 ml-4 md:ml-0'>
            <UserMenu />
          </div>
        </header>

        <main
          className='px-4 md:px-6'
          style={{
            paddingBottom: 'calc(5rem + env(safe-area-inset-bottom))',
          }}
        >
          {activeNav === 'home' ? (
            <>
              {continueWatching.length > 0 && (
                <section className='mb-10'>
                  <div className='flex items-center gap-3 mb-6 px-1'>
                    <div className='flex items-center gap-2'>
                      <CirclePlay className='w-6 h-6 text-accent' />
                      <h3 className='text-xl font-bold text-zinc-900 dark:text-white tracking-wide'>
                        繼續觀看
                      </h3>
                    </div>
                    {continueWatching.length > 0 && (
                      <button
                        className='ml-auto flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 transition-colors bg-zinc-100 dark:bg-zinc-800/50 hover:bg-red-50 dark:hover:bg-red-500/10 px-3 py-1.5 rounded-full'
                        onClick={async () => {
                          if (
                            window.confirm(
                              '確定要清除所有繼續觀看紀錄嗎？此動作無法復原。'
                            )
                          ) {
                            await clearAllPlayRecords();
                            setContinueWatching([]);
                            toast('已清空觀看紀錄', 'info');
                          }
                        }}
                      >
                        <Trash2 className='w-3.5 h-3.5' />
                        清空紀錄
                      </button>
                    )}
                  </div>
                  <div className='relative group/carousel [mask-image:linear-gradient(to_right,transparent,black_2%,black_98%,transparent)] md:[mask-image:linear-gradient(to_right,transparent,black_4%,black_96%,transparent)] -mx-2 px-2'>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        scrollRow(continueRef as any, 'left');
                      }}
                      className='absolute left-0 top-0 hidden h-full w-14 items-center justify-center bg-gradient-to-r from-white/85 to-transparent dark:from-black/55 transition-all duration-200 z-50 cursor-pointer md:flex'
                    >
                      <div className='w-10 h-10 rounded-full bg-white text-zinc-900 flex items-center justify-center font-black shadow-lg ring-1 ring-zinc-200 dark:ring-0'>
                        <ChevronLeft className='w-6 h-6' />
                      </div>
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        scrollRow(continueRef as any, 'right');
                      }}
                      className='absolute right-0 top-0 hidden h-full w-14 items-center justify-center bg-gradient-to-l from-white/85 to-transparent dark:from-black/55 transition-all duration-200 z-50 cursor-pointer md:flex'
                    >
                      <div className='w-10 h-10 rounded-full bg-white text-zinc-900 flex items-center justify-center font-black shadow-lg ring-1 ring-zinc-200 dark:ring-0'>
                        <ChevronRight className='w-6 h-6' />
                      </div>
                    </div>
                    <div
                      ref={continueRef}
                      className='flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth flex-nowrap no-scrollbar py-6 px-2 relative scroll-px-2'
                    >
                      {(() => {
                        return deduplicatePlayRecordList(continueWatching).map(
                          (item) => {
                            const progress =
                              item.total_time > 0
                                ? (item.play_time / item.total_time) * 100
                                : 0;

                            // 核心修復：精確切出當初 IndexedDB 快取的原始唯一辨識數位 ID 與片源
                            const parsedKey = parseStorageKey(item.key);
                            const rawId =
                              parsedKey?.id || item.id || item.vod_id;
                            const rawSource = parsedKey?.source || item.source;

                            const targetPlayId =
                              !rawId ||
                              rawId === 'undefined' ||
                              rawId === 'null'
                                ? ''
                                : rawId;
                            const targetPlaySource =
                              !rawSource ||
                              rawSource === 'undefined' ||
                              rawSource === 'null'
                                ? ''
                                : rawSource;
                            const isPrefer = !targetPlayId || !targetPlaySource;
                            const displaySourceName =
                              item.source_name ||
                              targetPlaySource ||
                              item.source ||
                              '';
                            const displaySourceLabel =
                              displaySourceName.replace(/^🎬\s*/, '');

                            return (
                              <div
                                key={item.key || `${item.source}+${item.id}`}
                                className='relative group vertical-card-container w-48 shrink-0 cursor-pointer'
                              >
                                <button
                                  onClick={() =>
                                    router.push(
                                      buildPlayUrl({
                                        id: targetPlayId,
                                        source: targetPlaySource,
                                        title: item.title || item.vod_name,
                                        prefer: isPrefer,
                                        url: item.url,
                                        stitle: item.search_title,
                                        episode:
                                          item.index && item.index > 0
                                            ? item.index
                                            : undefined,
                                      })
                                    )
                                  }
                                  onFocus={(e) =>
                                    e.currentTarget.scrollIntoView({
                                      behavior: 'smooth',
                                      block: 'nearest',
                                      inline: 'center',
                                    })
                                  }
                                  className='w-full h-full text-left'
                                >
                                  <div className='visual-box flex flex-col w-full h-full'>
                                    <div className='relative aspect-[2/3] w-full rounded-md overflow-hidden bg-zinc-800 transition-all border border-transparent group-hover:border-accent/80'>
                                      <ContinueWatchingCover
                                        cover={item.cover}
                                        title={item.title || item.vod_name}
                                        source={targetPlaySource}
                                        id={targetPlayId}
                                        onResolvedCover={async (poster) => {
                                          if (!poster || poster === item.cover)
                                            return;
                                          const itemKey =
                                            item.key ||
                                            generateStorageKey(
                                              targetPlaySource,
                                              targetPlayId
                                            );
                                          setContinueWatching((prev) =>
                                            prev.map((record) =>
                                              (record.key ||
                                                generateStorageKey(
                                                  record.source,
                                                  record.id || record.vod_id
                                                )) === itemKey
                                                ? { ...record, cover: poster }
                                                : record
                                            )
                                          );
                                        }}
                                      />
                                      <div className='absolute bottom-0 left-0 h-1.5 bg-black/40 w-full z-10'>
                                        <div
                                          className='h-full bg-accent'
                                          style={{ width: `${progress}%` }}
                                        />
                                      </div>
                                    </div>

                                    <h3 className='text-white text-[14px] font-medium line-clamp-1 group-hover:text-accent transition-colors mt-2 tracking-wide w-full'>
                                      {item.title || item.vod_name}
                                    </h3>

                                    <div className='flex items-center justify-between w-full mt-1 gap-2'>
                                      <span className='text-zinc-300 text-[12px] font-bold tracking-wide truncate'>
                                        {item.total_episodes &&
                                        item.total_episodes > 0
                                          ? `第 ${item.index} / ${item.total_episodes} 集`
                                          : `第 ${item.index} 集`}
                                      </span>
                                      <span
                                        title={displaySourceLabel}
                                        className='truncate px-2 py-0.5 bg-accent/15 text-accent border border-accent/20 text-[11px] font-bold rounded-sm shrink-0'
                                      >
                                        {displaySourceLabel}
                                      </span>
                                    </div>
                                  </div>
                                </button>
                                {/* 右上角 Hover 精緻手動刪除鈕 */}
                                <button
                                  onClick={(e) => handleDelete(e, item)}
                                  className='absolute top-3 right-3 w-6 h-6 rounded-full bg-black/80 text-zinc-200 flex items-center justify-center text-xs opacity-80 md:opacity-0 md:group-hover:opacity-100 hover:bg-red-600 hover:text-white transition-all duration-200 z-50 cursor-pointer shadow-md'
                                >
                                  <X className='w-3 h-3' />
                                </button>
                              </div>
                            );
                          }
                        );
                      })()}
                    </div>
                  </div>
                </section>
              )}

              <section className='mb-10'>
                <SectionTitle
                  title='最新上架'
                  icon={<Clapperboard className='w-5 h-5 text-accent' />}
                  viewAllHref='/douban?type=movie'
                />
                <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4'>
                  {[...hotMovies, ...hotTvShows]
                    .slice(0, 14)
                    .map((item, idx) => (
                      <NetflixGridCard key={`${item.id}-${idx}`} item={item} />
                    ))}
                </div>
              </section>

              <NetflixSectionRow
                title='熱門電影'
                icon={<Film className='w-5 h-5 text-accent' />}
                items={hotMovies}
                viewAllHref='/douban?type=movie'
                scrollRow={scrollRow}
              />

              <NetflixSectionRow
                title='熱門劇集'
                icon={<Tv className='w-5 h-5 text-accent' />}
                items={hotTvShows}
                viewAllHref='/douban?type=tv'
                scrollRow={scrollRow}
              />

              <NetflixBangumiRow
                bangumiData={bangumiData}
                scrollRow={scrollRow}
              />

              <NetflixSectionRow
                title='熱門綜藝'
                icon={<Star className='w-5 h-5 text-accent' />}
                items={hotVarietyShows}
                viewAllHref='/douban?type=show'
                scrollRow={scrollRow}
              />
            </>
          ) : (
            <FavoritesView />
          )}
        </main>
      </div>

      {announcement && showAnnouncement && (
        <div
          className='fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4'
          onTouchMove={(e) => e.stopPropagation()}
        >
          <div className='w-full max-w-md rounded-2xl bg-white dark:bg-[#1a1a1a] border border-zinc-200 dark:border-white/10 p-8 shadow-2xl'>
            <div className='flex items-start justify-between mb-6'>
              <div>
                <h3 className='text-xl font-bold text-zinc-900 dark:text-white mb-1'>
                  系統公告
                </h3>
                <div className='w-8 h-1 bg-accent rounded-full' />
              </div>
              <button
                onClick={() => handleCloseAnnouncement(announcement)}
                className='p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors'
              >
                <X className='w-5 h-5' />
              </button>
            </div>
            <div className='mb-8'>
              <div className='bg-zinc-50 dark:bg-[#141414] rounded-xl p-5 border-l-4 border-accent'>
                <p className='text-zinc-600 dark:text-zinc-300 leading-relaxed'>
                  {announcement}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full py-3 bg-accent hover:bg-[#ff557e] text-white font-bold rounded-xl transition-colors'
            >
              確定
            </button>
          </div>
        </div>
      )}
      <div className='md:hidden'>
        <MobileBottomNav
          activePath={activeNav === 'favorites' ? '/?tab=favorites' : '/'}
        />
      </div>
    </div>
  );
}
