/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { BookMarked, Plus, Settings2, Tag } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  type FavoriteTag,
  getAllItemTags,
  getFavoriteTags,
  setItemTags,
} from '@/lib/favorite-tags.client';
import { logger } from '@/lib/logger';
import { parseStorageKey } from '@/lib/storage-key';

import { useToast } from '@/components/ToastProvider';
import VideoCard from '@/components/VideoCard';

import { TagManagerModal } from './TagManagerModal';

export function FavoritesView() {
  const [favoriteItems, setFavoriteItems] = useState<
    {
      id: string;
      source: string;
      title: string;
      poster: string;
      episodes: number;
      source_name: string;
      currentEpisode?: number;
      search_title?: string;
      year?: string;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [itemTags, setItemTagsState] = useState<Record<string, string[]>>({});
  const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
  const [definedTags, setDefinedTags] = useState<FavoriteTag[]>([]);
  const favoriteRefreshRequestRef = useRef(0);

  const updateFavoriteItems = useCallback(
    async (allFavorites: Record<string, unknown>) => {
      const requestId = ++favoriteRefreshRequestRef.current;
      try {
        const allPlayRecords = await getAllPlayRecords();
        const sorted = Object.entries(allFavorites)
          .sort(
            ([, a], [, b]) =>
              (b as { save_time: number }).save_time -
              (a as { save_time: number }).save_time
          )
          .map(([key, fav]) => {
            const parsedKey = parseStorageKey(key);
            const source = parsedKey?.source || '';
            const id = parsedKey?.id || '';
            let playRecord = allPlayRecords[key];
            if (!playRecord) {
              playRecord =
                (Object.values(allPlayRecords).find(
                  (r: any) =>
                    r && (r.vod_id === id || r.id === id) && r.source === source
                ) as typeof playRecord) ?? undefined;
            }
            const f = fav as {
              title: string;
              year?: string;
              cover: string;
              total_episodes: number;
              source_name: string;
              search_title?: string;
            };
            return {
              id,
              source,
              title: f.title,
              year: f.year,
              poster: f.cover,
              episodes: f.total_episodes,
              source_name: f.source_name,
              currentEpisode: playRecord?.index,
              search_title: f.search_title,
            };
          });
        if (requestId === favoriteRefreshRequestRef.current) {
          setFavoriteItems(sorted);
        }
        return true;
      } catch (error) {
        logger.error('更新收藏列表失敗:', error);
        return false;
      }
    },
    []
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const allFavorites = await getAllFavorites();
        const updated = await updateFavoriteItems(allFavorites);
        if (!active) return;
        if (!updated) toast('載入收藏失敗，請稍後再試', 'error');
        setItemTagsState(getAllItemTags());
        setDefinedTags(getFavoriteTags());
      } catch (error) {
        logger.error('載入收藏失敗:', error);
        if (active) toast('載入收藏失敗，請稍後再試', 'error');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const unsub = subscribeToDataUpdates(
      'favoritesUpdated',
      updateFavoriteItems
    );
    return () => {
      active = false;
      favoriteRefreshRequestRef.current += 1;
      unsub();
    };
  }, [toast, updateFavoriteItems]);

  const refreshTags = () => {
    const nextTags = getFavoriteTags();
    setItemTagsState(getAllItemTags());
    setDefinedTags(nextTags);
    // 正在篩選的標籤若已在標籤管理中被刪除，要退回「全部」。否則清單會空掉、
    // 「全部」也不會highlight，使用者被卡在一個看不見的篩選條件上。
    setActiveTag((prev) =>
      prev && !nextTags.some((tag) => tag.name === prev) ? null : prev
    );
  };

  const handleClearAll = async () => {
    await clearAllFavorites();
    setFavoriteItems([]);
    localStorage.removeItem('moontv_favorite_tags_items');
    setItemTagsState({});
    toast('已清空所有收藏', 'info');
  };

  const filteredItems = activeTag
    ? favoriteItems.filter((item) => {
        const key = `${item.source}+${item.id}`;
        return (itemTags[key] || []).includes(activeTag);
      })
    : favoriteItems;

  const getItemTagNames = (key: string) => itemTags[key] || [];

  const toggleItemTag = (key: string, tagName: string) => {
    const current = getItemTagNames(key);
    const updated = current.includes(tagName)
      ? current.filter((t) => t !== tagName)
      : [...current, tagName];
    setItemTags(key, updated);
    setItemTagsState((prev) => ({ ...prev, [key]: updated }));
  };

  return (
    <div>
      <div className='flex items-center justify-between mb-4'>
        <div className='flex items-center gap-3'>
          <BookMarked className='w-6 h-6 text-accent' />
          <h2 className='text-2xl font-bold text-zinc-900 dark:text-white'>
            我的收藏
          </h2>
        </div>
        <div className='flex items-center gap-2'>
          {definedTags.length > 0 && (
            <button
              onClick={() => setTagManagerOpen(true)}
              className='text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors flex items-center gap-1'
            >
              <Tag className='w-4 h-4' />
              <span className='hidden sm:inline'>管理標籤</span>
            </button>
          )}
          {favoriteItems.length > 0 && (
            <button
              onClick={handleClearAll}
              className='text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors'
            >
              清空全部
            </button>
          )}
        </div>
      </div>

      {definedTags.length > 0 && (
        <div className='flex gap-2 mb-6 overflow-x-auto scrollbar-hide pb-1'>
          <button
            onClick={() => setActiveTag(null)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              activeTag === null
                ? 'bg-accent text-white'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
          >
            全部 ({favoriteItems.length})
          </button>
          {definedTags.map((tag) => {
            const count = favoriteItems.filter((item) => {
              const key = `${item.source}+${item.id}`;
              return (itemTags[key] || []).includes(tag.name);
            }).length;
            return (
              <button
                key={tag.name}
                onClick={() => setActiveTag(tag.name)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
                  activeTag === tag.name
                    ? 'text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
                style={
                  activeTag === tag.name
                    ? { backgroundColor: tag.color }
                    : undefined
                }
              >
                <span
                  className='w-2 h-2 rounded-full'
                  style={{ backgroundColor: tag.color }}
                />
                {tag.name} ({count})
              </button>
            );
          })}
          <button
            onClick={() => setTagManagerOpen(true)}
            className='flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all flex items-center gap-1'
          >
            <Settings2 className='w-3 h-3' />
          </button>
        </div>
      )}

      {loading ? (
        <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4'>
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className='aspect-[2/3] rounded-xl bg-zinc-200 dark:bg-zinc-800 animate-pulse'
            />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className='flex flex-col items-center justify-center py-24 text-zinc-500'>
          <BookMarked className='w-16 h-16 mb-4 opacity-30' />
          <p className='text-lg'>
            {activeTag ? '此標籤尚無內容' : '尚無收藏內容'}
          </p>
          <p className='text-sm mt-1'>
            {activeTag ? '試試其他標籤' : '快去探索心儀的影視作品吧！'}
          </p>
          {!activeTag && (
            <Link
              href='/search'
              className='mt-5 rounded-full bg-accent px-5 py-2 text-sm font-medium text-white shadow-lg shadow-accent/20 transition hover:bg-accent-deep'
            >
              前往搜尋
            </Link>
          )}
        </div>
      ) : definedTags.length === 0 ? (
        <div>
          <button
            onClick={() => setTagManagerOpen(true)}
            className='mb-6 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 rounded-xl text-sm text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all flex items-center gap-2'
          >
            <Plus className='w-4 h-4' /> 建立分類標籤
          </button>
          <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4'>
            {favoriteItems.map((item) => (
              <div key={`${item.source}-${item.id}`} className='w-full'>
                <VideoCard
                  query={item.search_title}
                  {...item}
                  from='favorite'
                  type={item.episodes > 1 ? 'tv' : ''}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className='grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-4'>
          {filteredItems.map((item) => {
            const key = `${item.source}+${item.id}`;
            const itemTagNames = getItemTagNames(key);
            const isEditing = editingItemKey === key;
            return (
              <div
                key={key}
                className='w-full relative group'
                onMouseEnter={() => setEditingItemKey(key)}
                onMouseLeave={() => setEditingItemKey(null)}
              >
                <VideoCard
                  query={item.search_title}
                  {...item}
                  from='favorite'
                  type={item.episodes > 1 ? 'tv' : ''}
                />
                {(isEditing || editingItemKey === null) &&
                  definedTags.length > 0 && (
                    <div
                      className={`absolute top-2 left-2 right-2 flex flex-wrap gap-1 ${
                        isEditing
                          ? ''
                          : 'opacity-100 md:opacity-0 md:group-hover:opacity-100'
                      } transition-opacity`}
                    >
                      {definedTags.map((tag) => {
                        const active = itemTagNames.includes(tag.name);
                        return (
                          <button
                            key={tag.name}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleItemTag(key, tag.name);
                            }}
                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium transition-all ${
                              active
                                ? 'text-white shadow-sm'
                                : 'bg-black/50 text-white/70 hover:bg-black/70'
                            }`}
                            style={
                              active
                                ? { backgroundColor: tag.color }
                                : undefined
                            }
                          >
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
              </div>
            );
          })}
        </div>
      )}

      <TagManagerModal
        open={tagManagerOpen}
        onClose={() => {
          setTagManagerOpen(false);
          refreshTags();
        }}
      />
      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
}
