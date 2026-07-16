'use client';

import {
  Activity,
  ArrowLeft,
  Clock3,
  Database,
  RefreshCw,
  Server,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import PageLayout from '@/components/PageLayout';

interface HealthData {
  status: 'healthy' | 'degraded';
  timestamp: string;
  version: string;
  uptimeSeconds: number;
  storage: {
    type: string;
    configured: boolean;
    connected: boolean;
    latencyMs: number;
    message: string;
    missing: string[];
  };
  cron: {
    running: boolean;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  };
  sources: { total: number; enabled: number; liveEnabled: number };
}

function formatDate(value: string | null): string {
  if (!value) return '尚無紀錄';
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days} 天 ${hours} 小時 ${minutes} 分鐘`;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        ok ? 'bg-emerald-500' : 'bg-amber-500'
      }`}
      aria-hidden='true'
    />
  );
}

export default function AdminHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/health', { cache: 'no-store' });
      const payload = (await response.json()) as HealthData & {
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || '無法讀取系統狀態');
      setData(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : '無法讀取系統狀態'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  return (
    <PageLayout activePath='/admin'>
      <main className='mx-auto w-full max-w-6xl px-4 py-8 sm:px-8'>
        <div className='mb-8 flex flex-wrap items-center justify-between gap-4'>
          <div>
            <Link
              href='/admin'
              className='mb-3 inline-flex items-center gap-2 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
            >
              <ArrowLeft size={16} /> 返回管理後台
            </Link>
            <h1 className='text-2xl font-bold text-zinc-900 dark:text-white'>
              系統健康狀態
            </h1>
            <p className='mt-2 text-sm text-zinc-500 dark:text-zinc-400'>
              唯讀顯示服務、儲存、排程與片源狀態，不會修改任何資料。
            </p>
          </div>
          <button
            type='button'
            onClick={() => void loadHealth()}
            disabled={loading}
            className='inline-flex h-10 items-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200'
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            重新整理
          </button>
        </div>

        {error && (
          <div className='border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200'>
            {error}
          </div>
        )}
        {loading && !data && (
          <div className='py-20 text-center text-zinc-500'>
            正在讀取系統狀態...
          </div>
        )}

        {data && (
          <div className='space-y-8'>
            <section className='border-y border-zinc-200 py-6 dark:border-zinc-800'>
              <div className='grid gap-6 sm:grid-cols-2 lg:grid-cols-4'>
                <div>
                  <div className='flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400'>
                    <Activity size={17} /> 整體狀態
                  </div>
                  <div className='mt-2 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-white'>
                    <StatusDot ok={data.status === 'healthy'} />
                    {data.status === 'healthy' ? '運作正常' : '需要注意'}
                  </div>
                </div>
                <div>
                  <div className='flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400'>
                    <Server size={17} /> 版本
                  </div>
                  <p className='mt-2 text-lg font-semibold'>{data.version}</p>
                </div>
                <div>
                  <div className='flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400'>
                    <Clock3 size={17} /> 運作時間
                  </div>
                  <p className='mt-2 text-lg font-semibold'>
                    {formatUptime(data.uptimeSeconds)}
                  </p>
                </div>
                <div>
                  <div className='text-sm text-zinc-500 dark:text-zinc-400'>
                    片源狀態
                  </div>
                  <p className='mt-2 text-lg font-semibold'>
                    {data.sources.enabled}/{data.sources.total} 啟用
                  </p>
                  <p className='text-xs text-zinc-500'>
                    直播片源 {data.sources.liveEnabled} 個
                  </p>
                </div>
              </div>
            </section>

            <section className='grid gap-8 lg:grid-cols-2'>
              <div className='border-t border-zinc-200 pt-5 dark:border-zinc-800'>
                <div className='flex items-center gap-2'>
                  <Database size={19} className='text-emerald-500' />
                  <h2 className='font-semibold'>儲存服務</h2>
                </div>
                <dl className='mt-4 space-y-3 text-sm'>
                  <div className='flex justify-between gap-4'>
                    <dt className='text-zinc-500'>類型</dt>
                    <dd className='font-medium'>{data.storage.type}</dd>
                  </div>
                  <div className='flex justify-between gap-4'>
                    <dt className='text-zinc-500'>連線</dt>
                    <dd className='flex items-center gap-2 font-medium'>
                      <StatusDot ok={data.storage.connected} />
                      {data.storage.connected ? '正常' : '失敗'}
                    </dd>
                  </div>
                  <div className='flex justify-between gap-4'>
                    <dt className='text-zinc-500'>回應時間</dt>
                    <dd>{data.storage.latencyMs} ms</dd>
                  </div>
                  {!data.storage.connected && (
                    <div className='break-words text-red-500'>
                      {data.storage.message}
                    </div>
                  )}
                </dl>
              </div>

              <div className='border-t border-zinc-200 pt-5 dark:border-zinc-800'>
                <div className='flex items-center gap-2'>
                  <Clock3 size={19} className='text-blue-500' />
                  <h2 className='font-semibold'>集數更新排程</h2>
                </div>
                <dl className='mt-4 space-y-3 text-sm'>
                  <div className='flex justify-between gap-4'>
                    <dt className='text-zinc-500'>目前狀態</dt>
                    <dd>{data.cron.running ? '執行中' : '閒置'}</dd>
                  </div>
                  <div>
                    <dt className='text-zinc-500'>上次成功</dt>
                    <dd className='mt-1'>
                      {formatDate(data.cron.lastSuccessAt)}
                    </dd>
                  </div>
                  {data.cron.lastError && (
                    <div className='break-words text-red-500'>
                      {data.cron.lastError}
                    </div>
                  )}
                </dl>
              </div>
            </section>

            <p className='text-xs text-zinc-500'>
              最後更新：{formatDate(data.timestamp)}
            </p>
          </div>
        )}
      </main>
    </PageLayout>
  );
}
