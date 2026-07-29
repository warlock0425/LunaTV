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

import { readErrorMessage } from '@/lib/safe-json';

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
  sources: {
    total: number;
    enabled: number;
    liveEnabled: number;
    tripped?: Array<{
      key: string;
      untilISO: string;
      consecutiveFailures: number;
    }>;
    health?: Array<{
      key: string;
      averageMs: number;
      samples: number;
      consecutiveTimeouts: number;
      disabledUntil: number;
      disabled: boolean;
    }>;
    validations?: Array<{
      source: string;
      status: string;
      message: string;
      episodeCount: number;
      latencyMs: number;
      levels: {
        search: string;
        detail: string;
        playable: string;
      };
      checkedAt: number;
    }>;
  };
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
    try {
      const response = await fetch('/api/admin/health', { cache: 'no-store' });
      // 先判斷狀態碼再解析：驗證失敗回的是純文字，硬解會拋 SyntaxError
      // 並蓋掉「登入已過期」這個真正的原因。
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '無法讀取系統狀態'));
      }
      const payload = (await response.json()) as HealthData;
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
    // 掛載時抓取資料：setState 皆發生於 await 之後，規則對具名函式為保守誤判
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
            onClick={() => {
              setLoading(true);
              setError(null);
              void loadHealth();
            }}
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

            {(data.sources.tripped?.length ||
              data.sources.health?.length ||
              data.sources.validations?.length) && (
              <section className='space-y-4'>
                <div className='flex flex-wrap items-center justify-between gap-3'>
                  <h2 className='text-lg font-semibold text-zinc-900 dark:text-white'>
                    片源健康與三級檢測
                  </h2>
                  <button
                    type='button'
                    onClick={async () => {
                      try {
                        const res = await fetch(
                          '/api/admin/source/health-reset',
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({}),
                          }
                        );
                        if (!res.ok) throw new Error('reset failed');
                        await loadHealth();
                      } catch {
                        setError('重置源健康狀態失敗');
                      }
                    }}
                    className='inline-flex h-9 items-center rounded-md border border-zinc-300 px-3 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900'
                  >
                    重置健康/熔斷
                  </button>
                </div>

                {!!data.sources.tripped?.length && (
                  <div className='overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800'>
                    <div className='border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-medium dark:border-zinc-800 dark:bg-zinc-900'>
                      熔斷中來源
                    </div>
                    <ul className='divide-y divide-zinc-200 text-sm dark:divide-zinc-800'>
                      {data.sources.tripped.map((item) => (
                        <li
                          key={item.key}
                          className='flex flex-wrap items-center justify-between gap-2 px-4 py-2'
                        >
                          <span className='font-mono'>{item.key}</span>
                          <span className='text-zinc-500'>
                            連續失敗 {item.consecutiveFailures} · 至{' '}
                            {formatDate(item.untilISO)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {!!data.sources.validations?.length && (
                  <div className='overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800'>
                    <div className='border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-medium dark:border-zinc-800 dark:bg-zinc-900'>
                      最近三級檢測（搜 / 解 / 播）
                    </div>
                    <div className='overflow-x-auto'>
                      <table className='min-w-full text-left text-sm'>
                        <thead className='bg-zinc-50 text-zinc-500 dark:bg-zinc-900'>
                          <tr>
                            <th className='px-4 py-2'>源</th>
                            <th className='px-4 py-2'>結果</th>
                            <th className='px-4 py-2'>搜/解/播</th>
                            <th className='px-4 py-2'>集數</th>
                            <th className='px-4 py-2'>耗時</th>
                            <th className='px-4 py-2'>說明</th>
                          </tr>
                        </thead>
                        <tbody className='divide-y divide-zinc-200 dark:divide-zinc-800'>
                          {data.sources.validations.map((item) => (
                            <tr key={item.source + String(item.checkedAt)}>
                              <td className='px-4 py-2 font-mono'>
                                {item.source}
                              </td>
                              <td className='px-4 py-2'>{item.status}</td>
                              <td className='px-4 py-2'>
                                {item.levels?.search}/{item.levels?.detail}/
                                {item.levels?.playable}
                              </td>
                              <td className='px-4 py-2'>{item.episodeCount}</td>
                              <td className='px-4 py-2'>{item.latencyMs}ms</td>
                              <td className='px-4 py-2 text-zinc-500'>
                                {item.message}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {!!data.sources.health?.length && (
                  <div className='overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800'>
                    <div className='border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-sm font-medium dark:border-zinc-800 dark:bg-zinc-900'>
                      搜尋延遲統計
                    </div>
                    <div className='overflow-x-auto'>
                      <table className='min-w-full text-left text-sm'>
                        <thead className='bg-zinc-50 text-zinc-500 dark:bg-zinc-900'>
                          <tr>
                            <th className='px-4 py-2'>源</th>
                            <th className='px-4 py-2'>平均耗時</th>
                            <th className='px-4 py-2'>樣本</th>
                            <th className='px-4 py-2'>狀態</th>
                          </tr>
                        </thead>
                        <tbody className='divide-y divide-zinc-200 dark:divide-zinc-800'>
                          {data.sources.health.map((item) => (
                            <tr key={item.key}>
                              <td className='px-4 py-2 font-mono'>
                                {item.key}
                              </td>
                              <td className='px-4 py-2'>{item.averageMs}ms</td>
                              <td className='px-4 py-2'>{item.samples}</td>
                              <td className='px-4 py-2'>
                                {item.disabled ? '暫時降權' : '可用'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </main>
    </PageLayout>
  );
}
