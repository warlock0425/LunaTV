/* eslint-disable @next/next/no-img-element */

'use client';

import { Clock, Search, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  deletePlayRecord,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import {
  deduplicatePlayRecordList,
  getPlayRecordKeysByIdentity,
  hydratePlayRecord,
} from '@/lib/play-records';
import { buildPlayUrl } from '@/lib/play-url';
import { parseStorageKey } from '@/lib/storage-key';
import { getProxiedImageUrl, processImageUrl } from '@/lib/utils';
import { calculateWatchStats, formatWatchTime } from '@/lib/watch-stats';

import PageLayout from '@/components/PageLayout';
import { useToast } from '@/components/ToastProvider';

type RecordEntry = PlayRecord & { key: string; source: string; id: string };

function normalizeRecordEntries(
  records: Record<string, PlayRecord>
): RecordEntry[] {
  return deduplicatePlayRecordList(
    Object.entries(records || {}).map(([key, record]) =>
      hydratePlayRecord({ ...record, key })
    )
  )
    .filter((r) => r.title && r.key)
    .sort((a, b) => b.save_time - a.save_time) as RecordEntry[];
}

function HistoryCover({ cover, title }: { cover?: string; title: string }) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = processImageUrl(cover || '');

  if (!imageUrl || imgError) {
    return (
      <div className='flex h-full w-full items-center justify-center bg-zinc-800 px-2 text-center text-[10px] font-medium leading-snug text-zinc-400'>
        {title || <Clock className='w-5 h-5' />}
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={title}
      className='w-full h-full object-cover'
      referrerPolicy='no-referrer'
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.dataset.retried && cover) {
          // 直連失敗，改走伺服器代理
          img.dataset.retried = 'true';
          img.src = getProxiedImageUrl(cover);
          return;
        }
        setImgError(true);
      }}
    />
  );
}

export default function HistoryPage() {
  const [records, setRecords] = useState<RecordEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const { toast } = useToast();

  const loadRecords = useCallback(async () => {
    try {
      const all = await getAllPlayRecords();
      setRecords(normalizeRecordEntries(all));
    } catch (e) {
      // 沒有這行提示的話，載入失敗與「真的沒有紀錄」在畫面上長得一模一樣，
      // 使用者只會以為自己的觀看紀錄不見了。
      console.error('載入觀看記錄失敗:', e);
      toast('載入觀看記錄失敗，請重新整理頁面', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // 掛載時抓取資料：setState 皆發生於 await 之後，規則對具名函式為保守誤判
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRecords();
    const unsub = subscribeToDataUpdates<Record<string, PlayRecord>>(
      'playRecordsUpdated',
      (all) => {
        setRecords(normalizeRecordEntries(all || {}));
      }
    );
    return () => unsub?.();
  }, [loadRecords]);

  const stats = useMemo(() => {
    if (records.length === 0) return null;
    const rawRecords: Record<string, PlayRecord> = {};
    records.forEach((r) => {
      rawRecords[r.key] = r;
    });
    return calculateWatchStats(rawRecords);
  }, [records]);

  const filteredRecords = useMemo(() => {
    if (!searchQuery.trim()) return records;
    const q = searchQuery.trim().toLowerCase();
    return records.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.source_name || '').toLowerCase().includes(q) ||
        (r.search_title || '').toLowerCase().includes(q)
    );
  }, [records, searchQuery]);
  const allFilteredSelected =
    filteredRecords.length > 0 &&
    filteredRecords.every((record) => selectedKeys.has(record.key));

  const handleDelete = async (record: RecordEntry) => {
    try {
      const parsedKey = parseStorageKey(record.key);
      const src = record.source || parsedKey?.source || '';
      const rid = record.id || parsedKey?.id || '';
      if (src && rid) {
        await deletePlayRecord(src, rid, {
          title: record.title,
          source_name: record.source_name,
        });
      }
      setRecords((prev) => {
        const keysToRemove = new Set(getPlayRecordKeysByIdentity(prev, record));
        return prev.filter((r) => !keysToRemove.has(r.key));
      });
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        getPlayRecordKeysByIdentity(records, record).forEach((key) =>
          next.delete(key)
        );
        return next;
      });
    } catch (e) {
      console.error('刪除記錄失敗:', e);
      toast('刪除記錄失敗，請稍後再試', 'error');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedKeys.size === 0) return;
    const targets = records.filter((r) => selectedKeys.has(r.key));
    try {
      await Promise.all(
        targets.map((r) => {
          const parsedKey = parseStorageKey(r.key);
          const src = r.source || parsedKey?.source || '';
          const rid = r.id || parsedKey?.id || '';
          if (src && rid) {
            return deletePlayRecord(src, rid, {
              title: r.title,
              source_name: r.source_name,
            });
          }
          return Promise.resolve();
        })
      );
      setRecords((prev) => {
        const keysToRemove = new Set<string>();
        targets.forEach((target) => {
          getPlayRecordKeysByIdentity(prev, target).forEach((key) =>
            keysToRemove.add(key)
          );
        });
        return prev.filter((r) => !keysToRemove.has(r.key));
      });
      setSelectedKeys(new Set());
    } catch (e) {
      console.error('批量刪除失敗:', e);
      toast('批量刪除失敗，請稍後再試', 'error');
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('確定要清除所有觀看記錄嗎？此動作無法復原。')) return;
    try {
      await clearAllPlayRecords();
      setRecords([]);
      setSelectedKeys(new Set());
    } catch (e) {
      console.error('清除所有記錄失敗:', e);
      toast('清除記錄失敗，請稍後再試', 'error');
    }
  };

  const toggleSelect = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      filteredRecords.forEach((record) => {
        if (allFilteredSelected) next.delete(record.key);
        else next.add(record.key);
      });
      return next;
    });
  };

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60 * 1000) return '剛剛';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分鐘前`;
    if (diff < 24 * 60 * 60 * 1000)
      return `${Math.floor(diff / 3600000)} 小時前`;
    if (diff < 7 * 24 * 60 * 60 * 1000)
      return `${Math.floor(diff / 86400000)} 天前`;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      '0'
    )}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatDuration = (seconds: number) => {
    if (!seconds || seconds <= 0) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <PageLayout activePath='/history'>
      <div className='px-4 md:px-8 py-6 max-w-6xl mx-auto'>
        {/* 頁面標題 */}
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6'>
          <div className='flex items-center gap-3'>
            <Clock className='w-7 h-7 text-accent' />
            <h1 className='text-2xl font-bold text-zinc-900 dark:text-white'>
              觀看記錄
            </h1>
            <span className='text-sm text-zinc-500 dark:text-zinc-400'>
              ({records.length})
            </span>
          </div>

          <div className='flex items-center gap-2'>
            {records.length > 0 && (
              <>
                <button
                  onClick={() => {
                    setSelectMode(!selectMode);
                    if (selectMode) setSelectedKeys(new Set());
                  }}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    selectMode
                      ? 'bg-accent/10 text-accent border border-accent/30'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white border border-transparent hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                >
                  {selectMode ? '取消選擇' : '批量選擇'}
                </button>

                {selectMode && selectedKeys.size > 0 && (
                  <button
                    onClick={handleBatchDelete}
                    className='px-3 py-1.5 text-sm bg-red-500/10 text-red-500 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors flex items-center gap-1'
                  >
                    <Trash2 className='w-3.5 h-3.5' />
                    刪除所選 ({selectedKeys.size})
                  </button>
                )}

                <button
                  onClick={handleClearAll}
                  className='px-3 py-1.5 text-sm text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 border border-transparent hover:border-red-300 dark:hover:border-red-700 rounded-lg transition-colors flex items-center gap-1'
                >
                  <Trash2 className='w-3.5 h-3.5' />
                  清空全部
                </button>
              </>
            )}
          </div>
        </div>

        {/* 搜尋欄 */}
        {records.length > 0 && (
          <div className='relative mb-6 max-w-md'>
            <Search className='absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400' />
            <input
              type='text'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='搜尋觀看記錄...'
              className='w-full h-10 pl-10 pr-8 bg-zinc-100 dark:bg-zinc-800/50 rounded-xl text-sm text-zinc-900 dark:text-white placeholder-zinc-400 border border-zinc-200 dark:border-zinc-700 focus:border-accent focus:outline-none transition-colors'
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className='absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              >
                <X className='w-4 h-4' />
              </button>
            )}
          </div>
        )}

        {/* 觀看統計 */}
        {stats && records.length > 0 && (
          <div className='mb-6'>
            <button
              type='button'
              onClick={() => setShowStats(!showStats)}
              aria-expanded={showStats}
              className='flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors mb-3'
            >
              <span
                className={`inline-block transition-transform duration-200 ${
                  showStats ? 'rotate-90' : ''
                }`}
                aria-hidden
              >
                ›
              </span>
              觀看統計
            </button>

            {showStats && (
              <div className='grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4'>
                {/* 總觀看時長 */}
                <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
                  <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-1'>
                    總觀看時長
                  </div>
                  <div className='text-lg font-bold text-zinc-900 dark:text-white'>
                    {formatWatchTime(stats.totalWatchTimeSeconds)}
                  </div>
                </div>

                {/* 觀看劇數 */}
                <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
                  <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-1'>
                    觀看劇數
                  </div>
                  <div className='text-lg font-bold text-zinc-900 dark:text-white'>
                    {stats.totalShows}
                    <span className='text-sm font-normal text-zinc-400 ml-1'>
                      ({stats.completedShows} 完結)
                    </span>
                  </div>
                </div>

                {/* 總觀看集數 */}
                <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
                  <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-1'>
                    總觀看集數
                  </div>
                  <div className='text-lg font-bold text-zinc-900 dark:text-white'>
                    {stats.totalEpisodesWatched}
                  </div>
                </div>

                {/* 最常用片源 */}
                <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50'>
                  <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-1'>
                    最常用片源
                  </div>
                  <div className='text-lg font-bold text-zinc-900 dark:text-white truncate'>
                    {stats.favoriteSource}
                  </div>
                </div>
              </div>
            )}

            {/* 最近 7 天觀看趨勢 */}
            {showStats && stats.dailyWatchTime.some((d) => d.seconds > 0) && (
              <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 mb-4'>
                <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-3'>
                  最近 7 天觀看時長
                </div>
                <div className='flex items-end gap-2 h-24'>
                  {stats.dailyWatchTime.map((day, i) => {
                    const maxSeconds = Math.max(
                      ...stats.dailyWatchTime.map((d) => d.seconds),
                      1
                    );
                    const height = Math.max(
                      (day.seconds / maxSeconds) * 100,
                      2
                    );
                    return (
                      <div
                        key={i}
                        className='flex-1 flex flex-col items-center gap-1'
                      >
                        <div className='text-[10px] text-zinc-400'>
                          {day.seconds > 0 ? formatWatchTime(day.seconds) : ''}
                        </div>
                        <div
                          className='w-full bg-accent/80 rounded-t transition-all duration-300'
                          style={{ height: `${height}%` }}
                        />
                        <div className='text-[10px] text-zinc-400'>
                          {day.date}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 片源統計 */}
            {showStats && stats.topSources.length > 0 && (
              <div className='bg-zinc-100 dark:bg-zinc-800/50 rounded-xl p-4 border border-zinc-200 dark:border-zinc-700/50 mb-4'>
                <div className='text-xs text-zinc-500 dark:text-zinc-400 mb-3'>
                  片源使用統計
                </div>
                <div className='space-y-2'>
                  {stats.topSources.map((source, i) => (
                    <div key={i} className='flex items-center gap-3'>
                      <div className='w-20 text-xs text-zinc-500 dark:text-zinc-400 truncate'>
                        {source.name}
                      </div>
                      <div className='flex-1 bg-zinc-200 dark:bg-zinc-700 rounded-full h-2 overflow-hidden'>
                        <div
                          className='h-full bg-accent/80 rounded-full transition-all duration-300'
                          style={{
                            width: `${
                              (source.count / stats.totalShows) * 100
                            }%`,
                          }}
                        />
                      </div>
                      <div className='w-8 text-xs text-zinc-400 text-right'>
                        {source.count}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 全選 */}
        {selectMode && filteredRecords.length > 0 && (
          <div className='mb-3'>
            <label className='flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400 cursor-pointer select-none'>
              <input
                type='checkbox'
                checked={allFilteredSelected}
                onChange={toggleSelectAll}
                className='w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-accent focus:ring-accent'
              />
              全選 ({filteredRecords.length} 項)
            </label>
          </div>
        )}

        {/* 記錄列表 */}
        {loading ? (
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className='h-24 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 animate-pulse'
              />
            ))}
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-24 px-4 text-center'>
            <div className='mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-zinc-900/60'>
              <Clock className='w-8 h-8 text-zinc-500' aria-hidden />
            </div>
            <p className='text-lg font-medium text-zinc-200'>
              {searchQuery ? '找不到匹配的記錄' : '尚無觀看記錄'}
            </p>
            <p className='text-sm mt-2 max-w-sm text-zinc-500 leading-relaxed'>
              {searchQuery
                ? '試試其他關鍵字，或清除搜尋後查看全部紀錄'
                : '開始觀看後，進度會自動出現在這裡，方便接著看'}
            </p>
            {!searchQuery ? (
              <Link
                href='/search'
                className='mt-6 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/20 transition hover:bg-accent/90'
              >
                前往搜尋
              </Link>
            ) : (
              <button
                type='button'
                onClick={() => setSearchQuery('')}
                className='mt-6 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10'
              >
                清除搜尋
              </button>
            )}
          </div>
        ) : (
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
            {filteredRecords.map((record) => {
              const progress =
                record.total_time > 0
                  ? Math.min(
                      100,
                      Math.max(
                        0,
                        Math.round((record.play_time / record.total_time) * 100)
                      )
                    )
                  : 0;
              const isSelected = selectedKeys.has(record.key);

              return (
                <div
                  key={record.key}
                  className={`group relative flex gap-3 p-3 rounded-xl border transition-all duration-200 ${
                    isSelected
                      ? 'border-accent bg-accent/5'
                      : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:border-zinc-300 dark:hover:border-zinc-700 hover:shadow-sm'
                  }`}
                >
                  {/* 選擇模式勾選框 */}
                  {selectMode && (
                    <div className='absolute top-3 left-3 z-10'>
                      <input
                        type='checkbox'
                        checked={isSelected}
                        onChange={() => toggleSelect(record.key)}
                        className='w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-accent focus:ring-accent'
                      />
                    </div>
                  )}

                  {/* 封面 */}
                  <Link
                    href={buildPlayUrl({
                      source: record.source,
                      id: record.id,
                      title: record.title,
                      stitle: record.search_title,
                      episode:
                        record.index && record.index > 0
                          ? record.index
                          : undefined,
                    })}
                    className={`flex-shrink-0 w-16 h-24 rounded-lg overflow-hidden bg-zinc-200 dark:bg-zinc-800 ${
                      selectMode ? 'pointer-events-none' : ''
                    }`}
                  >
                    <HistoryCover cover={record.cover} title={record.title} />
                  </Link>

                  {/* 資訊 */}
                  <div className='flex-1 min-w-0'>
                    <Link
                      href={buildPlayUrl({
                        source: record.source,
                        id: record.id,
                        title: record.title,
                        stitle: record.search_title,
                        episode:
                          record.index && record.index > 0
                            ? record.index
                            : undefined,
                      })}
                      className={`font-medium text-sm text-zinc-900 dark:text-white truncate block hover:text-accent transition-colors ${
                        selectMode ? 'pointer-events-none' : ''
                      }`}
                    >
                      {record.title}
                    </Link>

                    <div className='flex items-center gap-2 mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
                      {record.source_name && (
                        <span
                          title={record.source_name}
                          className='max-w-[8rem] truncate px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-[10px]'
                        >
                          {record.source_name}
                        </span>
                      )}
                      {record.year && <span>{record.year}</span>}
                    </div>

                    {/* 進度：加粗一點，方便一眼看出「看到哪」 */}
                    <div className='mt-2'>
                      <div className='flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 mb-1'>
                        <span>
                          {record.index > 0 && record.total_episodes > 0
                            ? `第 ${record.index} / ${record.total_episodes} 集`
                            : record.total_episodes > 1
                              ? `${record.total_episodes} 集`
                              : '進度'}
                        </span>
                        <span className='tabular-nums text-zinc-400'>
                          {progress > 0 ? `${progress}%` : '未開始'}
                          {record.play_time > 0
                            ? ` · ${formatDuration(record.play_time)}`
                            : ''}
                        </span>
                      </div>
                      <div className='w-full h-1.5 bg-zinc-200 dark:bg-zinc-700/80 rounded-full overflow-hidden'>
                        <div
                          className='h-full bg-accent rounded-full transition-all'
                          style={{
                            width: `${Math.max(progress, progress > 0 ? 2 : 0)}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* 時間 */}
                    <div className='text-[10px] text-zinc-400 mt-1'>
                      {formatDate(record.save_time)}
                    </div>
                  </div>

                  {/* 刪除按鈕 */}
                  {!selectMode && (
                    <button
                      onClick={() => handleDelete(record)}
                      className='absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 text-zinc-300 flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 hover:bg-red-600 hover:text-white transition-all duration-200'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 底部留白 */}
        <div className='h-20' />
      </div>
    </PageLayout>
  );
}
