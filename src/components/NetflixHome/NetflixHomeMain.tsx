/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { HeroResume } from './HeroResume';
import { NetflixBangumiRow } from './NetflixBangumiRow';
import { NetflixGridCard } from './NetflixGridCard';
import { NetflixSectionRow } from './NetflixSectionRow';
import { SectionTitle } from './SectionTitle';
import {
  formatEpisodeLabel,
  formatSourceLabel,
  getWatchProgress,
  resolveRecordPlayTarget,
} from './utils';

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
  const [activeNav, setActiveNav] = useState<'home' | 'favorites'>(() =>
    tab === 'favorites' ? 'favorites' : 'home'
  );
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  // 交錯電影與劇集，避免這一區塊與下方「熱門電影」「熱門劇集」顯示同一批內容
  // （電影數量本來就超過 14，直接串接會讓前 14 筆全是電影）
  const mixedHighlights = useMemo(() => {
    const mixed: DoubanItem[] = [];
    const longest = Math.max(hotMovies.length, hotTvShows.length);
    for (let i = 0; i < longest && mixed.length < 14; i++) {
      if (hotMovies[i]) mixed.push(hotMovies[i]);
      if (mixed.length < 14 && hotTvShows[i]) mixed.push(hotTvShows[i]);
    }
    return mixed;
  }, [hotMovies, hotTvShows]);

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

  // 依 save_time 由新到舊排序後，第一筆即「最後看的那部」，交給頂部的接著看區塊；
  // 其餘留給下方的繼續觀看列，避免同一部在畫面上出現兩次。
  const orderedContinueWatching = useMemo(
    () => deduplicatePlayRecordList(continueWatching),
    [continueWatching]
  );
  const heroRecord = orderedContinueWatching[0];
  const remainingContinueWatching = orderedContinueWatching.slice(1);

  // 補圖成功後寫回紀錄，hero 與下方列表共用；下次渲染就直接有封面。
  const applyResolvedCover = useCallback((item: any, poster: string) => {
    if (!poster || poster === item.cover) return;
    const { source, id } = resolveRecordPlayTarget(item);
    const itemKey = item.key || generateStorageKey(source, id);

    setContinueWatching((prev) =>
      prev.map((record) =>
        (record.key ||
          generateStorageKey(record.source, record.id || record.vod_id)) ===
        itemKey
          ? { ...record, cover: poster }
          : record
      )
    );
  }, []);

  const handleClearAllRecords = useCallback(async () => {
    if (!window.confirm('確定要清除所有繼續觀看紀錄嗎？此動作無法復原。')) {
      return;
    }
    await clearAllPlayRecords();
    setContinueWatching([]);
    toast('已清空觀看紀錄', 'info');
  }, [toast]);

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

      // 補掃同名殘留（deletePlayRecord 只比對 source+id，抓不到同名不同 id 的舊紀錄）。
      // 使用者身分一律由伺服器從 cookie 判定，不從客戶端傳。
      await fetch('/api/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vod_name: item.title || item.vod_name,
          source: realSource,
          source_name: item.source_name,
        }),
      }).catch((err) => {
        console.warn('API 歷史刪除失敗:', err);
      });
    } catch (err) {
      console.error('刪除播放記錄錯誤:', err);
      toast('刪除觀看紀錄失敗，請稍後再試', 'error');
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
              ? 'bg-white/80 dark:bg-surface-page/80 backdrop-blur-xl border-b border-zinc-200 dark:border-white/5'
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
                placeholder='搜尋電影、電視劇、動漫…'
                className='w-full md:w-[28rem] max-w-full h-11 pl-12 pr-4 bg-zinc-100 dark:bg-zinc-900/90 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-500 dark:placeholder-zinc-400 border border-zinc-200 dark:border-white/10 focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-all duration-200'
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
              {heroRecord ? (
                <HeroResume
                  item={heroRecord}
                  othersCount={remainingContinueWatching.length}
                  // 只剩這一筆時下方不會有繼續觀看列，清空紀錄改掛在 hero 上，
                  // 否則使用者就沒有任何入口可以清除歷史。
                  onClearHistory={
                    remainingContinueWatching.length === 0
                      ? handleClearAllRecords
                      : undefined
                  }
                  onResolvedCover={(poster) =>
                    applyResolvedCover(heroRecord, poster)
                  }
                />
              ) : (
                <section className='mb-10 rounded-2xl border border-white/10 bg-zinc-900/50 px-6 py-10 sm:px-10 sm:py-12'>
                  <p className='text-accent text-xs font-bold tracking-[0.2em] uppercase mb-3'>
                    開始觀看
                  </p>
                  <h2 className='text-2xl sm:text-3xl font-bold text-white mb-3'>
                    搜尋你想看的影視
                  </h2>
                  <p className='text-sm text-zinc-400 max-w-lg leading-relaxed mb-6'>
                    支援繁中關鍵字與陸源片名。看過之後會出現在「接著看」與「繼續觀看」。
                  </p>
                  <button
                    type='button'
                    onClick={() => router.push('/search')}
                    className='inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-bold text-white shadow-lg shadow-accent/20 transition hover:bg-accent/90'
                  >
                    <Search className='w-4 h-4' />
                    前往搜尋
                  </button>
                </section>
              )}

              {remainingContinueWatching.length > 0 && (
                <section id='continue-watching' className='mb-10 scroll-mt-24'>
                  <div className='flex items-center gap-3 mb-4 px-1'>
                    <div className='flex items-center gap-2 min-w-0'>
                      <CirclePlay className='w-5 h-5 text-accent shrink-0' />
                      <h3 className='text-lg sm:text-xl font-bold text-white tracking-wide truncate'>
                        繼續觀看
                      </h3>
                      <span className='text-xs text-zinc-500 tabular-nums shrink-0'>
                        {remainingContinueWatching.length}
                      </span>
                    </div>
                    <button
                      type='button'
                      className='ml-auto flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-red-400 transition-colors bg-zinc-800/50 hover:bg-red-500/10 px-3 py-1.5 rounded-full shrink-0'
                      onClick={handleClearAllRecords}
                    >
                      <Trash2 className='w-3.5 h-3.5' />
                      清空紀錄
                    </button>
                  </div>
                  <div className='relative group/carousel [mask-image:linear-gradient(to_right,transparent,black_2%,black_98%,transparent)] md:[mask-image:linear-gradient(to_right,transparent,black_4%,black_96%,transparent)] -mx-2 px-2'>
                    {/* 改用 button：原為 <div onClick>，鍵盤無法操作 */}
                    <button
                      type='button'
                      aria-label='向左捲動'
                      onClick={(e) => {
                        e.stopPropagation();
                        scrollRow(continueRef as any, 'left');
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
                        scrollRow(continueRef as any, 'right');
                      }}
                      className='absolute right-0 top-0 hidden h-full w-14 items-center justify-center bg-gradient-to-l from-white/85 to-transparent dark:from-black/55 transition-all duration-200 z-50 cursor-pointer md:flex'
                    >
                      <span className='w-10 h-10 rounded-full bg-white text-zinc-900 flex items-center justify-center font-black shadow-lg ring-1 ring-zinc-200 dark:ring-0'>
                        <ChevronRight className='w-6 h-6' />
                      </span>
                    </button>
                    <div
                      ref={continueRef}
                      className='flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth flex-nowrap no-scrollbar py-6 px-2 relative scroll-px-2'
                    >
                      {remainingContinueWatching.map((item) => {
                        const progress = getWatchProgress(item);

                        const {
                          source: targetPlaySource,
                          id: targetPlayId,
                          isPrefer,
                        } = resolveRecordPlayTarget(item);
                        const displaySourceLabel = formatSourceLabel(
                          item,
                          targetPlaySource
                        );

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
                              type='button'
                              className='w-full h-full text-left'
                            >
                              <div className='visual-box flex flex-col w-full h-full'>
                                <div className='relative aspect-[2/3] w-full rounded-lg overflow-hidden bg-zinc-800 transition-all border border-white/5 group-hover:border-accent/70 group-hover:shadow-[0_0_20px_rgba(0,180,216,0.15)]'>
                                  <ContinueWatchingCover
                                    cover={item.cover}
                                    title={item.title || item.vod_name}
                                    source={targetPlaySource}
                                    id={targetPlayId}
                                    onResolvedCover={(poster) =>
                                      applyResolvedCover(item, poster)
                                    }
                                  />
                                  {/* 懸停播放提示 */}
                                  <div className='pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/35 transition-colors'>
                                    <CirclePlay className='w-10 h-10 text-white opacity-0 group-hover:opacity-95 drop-shadow-lg transition-opacity' />
                                  </div>
                                  <div className='absolute bottom-0 left-0 right-0 z-10'>
                                    <div className='h-1 bg-black/50 w-full'>
                                      <div
                                        className='h-full bg-accent shadow-[0_0_8px_rgba(0,180,216,0.55)]'
                                        style={{
                                          width: `${Math.max(progress, progress > 0 ? 3 : 0)}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>

                                <h3 className='text-white text-[13px] sm:text-[14px] font-medium line-clamp-2 group-hover:text-accent transition-colors mt-2 tracking-wide w-full leading-snug min-h-[2.5rem]'>
                                  {item.title || item.vod_name}
                                </h3>

                                <div className='flex items-center justify-between w-full mt-1 gap-2'>
                                  <span className='text-zinc-400 text-[11px] sm:text-[12px] font-semibold tracking-wide truncate tabular-nums'>
                                    {formatEpisodeLabel(item)}
                                  </span>
                                  <span
                                    title={displaySourceLabel}
                                    className='max-w-[5.5rem] truncate px-1.5 py-0.5 bg-accent/12 text-accent border border-accent/20 text-[10px] font-bold rounded-sm shrink-0'
                                  >
                                    {displaySourceLabel}
                                  </span>
                                </div>
                              </div>
                            </button>
                            {/* 刪除：手機常顯、桌面 hover 顯 */}
                            <button
                              type='button'
                              aria-label='移除此紀錄'
                              onClick={(e) => handleDelete(e, item)}
                              className='absolute top-2 right-2 w-7 h-7 rounded-full bg-black/75 text-zinc-200 flex items-center justify-center opacity-90 md:opacity-0 md:group-hover:opacity-100 hover:bg-red-600 hover:text-white transition-all duration-200 z-50 cursor-pointer shadow-md'
                            >
                              <X className='w-3.5 h-3.5' />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              )}

              <section className='mb-10'>
                <SectionTitle
                  title='熱門影劇'
                  icon={<Clapperboard className='w-5 h-5 text-accent' />}
                  viewAllHref='/douban?type=movie'
                />
                <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4'>
                  {mixedHighlights.map((item, idx) => (
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
          <div className='w-full max-w-md rounded-2xl bg-white dark:bg-surface-panel border border-zinc-200 dark:border-white/10 p-8 shadow-2xl'>
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
              <div className='bg-zinc-50 dark:bg-anime-bg rounded-xl p-5 border-l-4 border-accent'>
                <p className='text-zinc-600 dark:text-zinc-300 leading-relaxed'>
                  {announcement}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full py-3 bg-accent hover:bg-accent-deep text-white font-bold rounded-xl transition-colors'
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
