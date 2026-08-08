'use client';

import { useCallback, useEffect, useState } from 'react';

import { buttonStyles } from './buttonStyles';

interface ZeroResultEntry {
  query: string;
  count: number;
  lastAt: number;
}

export function SearchZeroResultsPanel() {
  const [entries, setEntries] = useState<ZeroResultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/search-zero-results');
      if (!response.ok) {
        throw new Error('取得零結果清單失敗');
      }
      const data = (await response.json()) as { entries?: ZeroResultEntry[] };
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得零結果清單失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 掛載時抓取資料：setState 皆發生於 await 之後，規則對具名函式為保守誤判
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEntries();
  }, [fetchEntries]);

  const formatLastAt = (timestamp: number) => {
    if (!timestamp) return '—';
    // 相對時間為顯示用途，讀取當下時間屬預期行為
    // eslint-disable-next-line react-hooks/purity
    const diff = Date.now() - timestamp;
    if (diff < 60 * 1000) return '剛剛';
    if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分鐘前`;
    if (diff < 24 * 60 * 60 * 1000)
      return `${Math.floor(diff / 3600000)} 小時前`;
    if (diff < 7 * 24 * 60 * 60 * 1000)
      return `${Math.floor(diff / 86400000)} 天前`;
    return new Date(timestamp).toLocaleString('zh-TW', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center py-12'>
        <div className='w-8 h-8 border-[3px] border-accent border-t-transparent rounded-full animate-spin' />
      </div>
    );
  }

  if (error) {
    return (
      <div className='space-y-3 py-4'>
        <p className='text-sm text-red-500'>{error}</p>
        <button
          type='button'
          onClick={() => void fetchEntries()}
          className={buttonStyles.secondary}
        >
          重試
        </button>
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      <p className='text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed'>
        站內搜尋完全沒結果時會記一筆（只存詞、次數與時間，不綁帳號）。
        跑一段時間後，這裡就是補「台譯 ↔
        陸名」表的真實依據——錯別名比找不到更糟，請人工核對豆瓣後再收錄。
      </p>
      <div className='flex justify-end'>
        <button
          type='button'
          onClick={() => void fetchEntries()}
          className={buttonStyles.secondary}
        >
          重新整理
        </button>
      </div>
      {entries.length === 0 ? (
        <p className='py-8 text-center text-sm text-zinc-500'>
          尚無零結果紀錄。有人搜不到片之後會出現在這裡。
        </p>
      ) : (
        <div className='overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700'>
          <table className='min-w-full text-sm'>
            <thead className='bg-zinc-50 dark:bg-zinc-800/80 text-left text-zinc-600 dark:text-zinc-300'>
              <tr>
                <th className='px-3 py-2 font-medium'>查詢詞</th>
                <th className='px-3 py-2 font-medium whitespace-nowrap'>
                  次數
                </th>
                <th className='px-3 py-2 font-medium whitespace-nowrap'>
                  最近一次
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-zinc-100 dark:divide-zinc-800'>
              {entries.map((entry) => (
                <tr
                  key={entry.query}
                  className='text-zinc-800 dark:text-zinc-200'
                >
                  <td className='px-3 py-2 font-medium break-all'>
                    {entry.query}
                  </td>
                  <td className='px-3 py-2 tabular-nums'>{entry.count}</td>
                  <td className='px-3 py-2 text-zinc-500 dark:text-zinc-400 whitespace-nowrap'>
                    {formatLastAt(entry.lastAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
