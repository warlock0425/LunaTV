'use client';

import {
  ArrowLeft,
  ChevronDown,
  Globe,
  Image as ImageIcon,
  Search,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  clearStreamingSearchPreference,
  readStreamingSearchPreference,
  writeStreamingSearchPreference,
} from '@/lib/streaming-search-preference';
import { useMounted } from '@/hooks/useClientMount';

import ChangePasswordCard from '@/components/ChangePasswordCard';

const DATA_PROXY_OPTIONS = [
  { value: 'direct', label: '直連（伺服器直接請求豆瓣）' },
  { value: 'cmliussss-cdn-tencent', label: '騰訊 CDN' },
  { value: 'cmliussss-cdn-ali', label: '阿里 CDN' },
  { value: 'cors-proxy-zwei', label: 'CORS 代理' },
  { value: 'cors-anywhere', label: 'CORS Anywhere' },
  { value: 'custom', label: '自定義代理' },
];

const IMAGE_PROXY_OPTIONS = [
  { value: 'server', label: '伺服器代理（由伺服器代理請求豆瓣）' },
  { value: 'cmliussss-cdn-tencent', label: '騰訊 CDN' },
  { value: 'cmliussss-cdn-ali', label: '阿里 CDN' },
  { value: 'custom', label: '自定義代理' },
];

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className='flex items-start justify-between gap-4 py-4'>
      <div className='flex-1 min-w-0'>
        <p className='text-sm font-bold text-zinc-900 dark:text-white'>
          {label}
        </p>
        <p className='text-xs text-zinc-500 mt-1 leading-relaxed'>
          {description}
        </p>
      </div>
      <button
        type='button'
        role='switch'
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-7 rounded-full transition-all duration-300 flex-shrink-0 ${
          checked ? 'bg-accent' : 'bg-zinc-300 dark:bg-zinc-700'
        }`}
      >
        <span
          className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-all duration-300 ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const mounted = useMounted();

  // UI 由 mounted 旗標擋住首輪 hydration，lazy 讀 localStorage 不會造成
  // 標記不一致
  const isClient = typeof window !== 'undefined';
  const [doubanSource, setDoubanSource] = useState(() =>
    isClient
      ? localStorage.getItem('doubanDataSource') || 'cmliussss-cdn-tencent'
      : 'cmliussss-cdn-tencent'
  );
  const [proxyUrl, setProxyUrl] = useState(() =>
    isClient ? localStorage.getItem('doubanProxyUrl') || '' : ''
  );
  const [imageProxyType, setImageProxyType] = useState(() =>
    isClient
      ? localStorage.getItem('doubanImageProxyType') || 'cmliussss-cdn-tencent'
      : 'cmliussss-cdn-tencent'
  );
  const [imageProxyUrl, setImageProxyUrl] = useState(() =>
    isClient ? localStorage.getItem('doubanImageProxyUrl') || '' : ''
  );
  const [enableOptimization, setEnableOptimization] = useState(() =>
    isClient ? localStorage.getItem('enableOptimization') !== 'false' : true
  );
  const [aggregateResults, setAggregateResults] = useState(() =>
    isClient
      ? (localStorage.getItem('defaultAggregateSearch') ??
          localStorage.getItem('defaultAggregateResults')) !== 'false'
      : true
  );
  const [streamSearch, setStreamSearch] = useState(() =>
    isClient ? readStreamingSearchPreference(localStorage, true) : true
  );
  const [iptvDirect, setIptvDirect] = useState(() =>
    isClient ? localStorage.getItem('iptvDirectConnect') === 'true' : false
  );
  const [saveMessage, setSaveMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const saveMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const handleBack = () => {
    if (typeof window !== 'undefined') {
      const returnTo = new URLSearchParams(window.location.search).get(
        'returnTo'
      );
      if (returnTo?.startsWith('/')) {
        router.replace(returnTo);
        return;
      }
    }
    router.back();
  };

  useEffect(() => {
    return () => {
      if (saveMessageTimerRef.current) {
        clearTimeout(saveMessageTimerRef.current);
      }
    };
  }, []);

  const showSaveMessage = (message: string) => {
    if (saveMessageTimerRef.current) {
      clearTimeout(saveMessageTimerRef.current);
    }
    setSaveMessage(message);
    saveMessageTimerRef.current = setTimeout(() => {
      setSaveMessage('');
      saveMessageTimerRef.current = null;
    }, 2000);
  };

  const handleSave = () => {
    // 沒有這道 try 的話，配額不足或無痕模式下第一個 setItem 就會拋錯：
    // 後面的設定全部沒寫入，而且連「已儲存」的提示都不會執行——
    // 使用者按了儲存卻毫無反應，也不知道失敗了。
    try {
      localStorage.setItem('doubanDataSource', doubanSource);
      localStorage.setItem('doubanProxyUrl', proxyUrl);
      localStorage.setItem('doubanImageProxyType', imageProxyType);
      localStorage.setItem('doubanImageProxyUrl', imageProxyUrl);
      localStorage.setItem('enableOptimization', String(enableOptimization));
      localStorage.setItem('defaultAggregateSearch', String(aggregateResults));
      localStorage.removeItem('defaultAggregateResults');
      writeStreamingSearchPreference(localStorage, streamSearch);
      localStorage.setItem('iptvDirectConnect', String(iptvDirect));
      showSaveMessage('設定已儲存');
    } catch {
      showSaveMessage('儲存失敗，瀏覽器可能已停用或用盡本機儲存空間');
    }
  };

  const handleReset = () => {
    try {
      localStorage.removeItem('doubanDataSource');
      localStorage.removeItem('doubanProxyUrl');
      localStorage.removeItem('doubanImageProxyType');
      localStorage.removeItem('doubanImageProxyUrl');
      localStorage.removeItem('enableOptimization');
      localStorage.removeItem('defaultAggregateSearch');
      localStorage.removeItem('defaultAggregateResults');
      clearStreamingSearchPreference(localStorage);
      localStorage.removeItem('iptvDirectConnect');
    } catch {
      // 清除失敗不該擋住畫面上的重設；下方仍會把狀態還原為預設值
    }
    setDoubanSource('cmliussss-cdn-tencent');
    setProxyUrl('');
    setImageProxyType('cmliussss-cdn-tencent');
    setImageProxyUrl('');
    setEnableOptimization(true);
    setAggregateResults(true);
    setStreamSearch(true);
    setIptvDirect(false);
    showSaveMessage('已恢復預設值');
  };

  if (!mounted) return null;

  return (
    <div className='min-h-screen bg-zinc-50 dark:bg-anime-bg text-zinc-900 dark:text-white'>
      {/* 頂部導航 */}
      <div className='fixed top-0 left-0 right-0 z-50 bg-white/80 dark:bg-anime-bg/90 backdrop-blur-md border-b border-zinc-200 dark:border-white/5'>
        <div className='flex items-center justify-between px-4 sm:px-10 h-14'>
          <div className='flex items-center gap-3'>
            <button
              onClick={handleBack}
              className='-ml-2 flex items-center gap-2 rounded-lg px-2 py-2.5 text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white'
            >
              <ArrowLeft className='w-5 h-5' />
              <span className='text-sm font-medium'>返回</span>
            </button>
            <h1 className='text-lg font-bold tracking-wide'>本地設定</h1>
          </div>
          <button
            onClick={handleReset}
            className='-mr-1 rounded-lg px-3 py-3 text-xs font-medium text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-accent'
          >
            恢復預設
          </button>
        </div>
      </div>

      <div className='pt-20 pb-20 px-4 sm:px-10 max-w-3xl mx-auto space-y-5'>
        {/* 常用：搜尋與播放 */}
        <div className='bg-white dark:bg-zinc-900/60 backdrop-blur-sm rounded-2xl border border-zinc-200 dark:border-white/5 p-6 divide-y divide-zinc-200 dark:divide-zinc-800/50'>
          <div className='flex items-center gap-3 mb-2'>
            <div className='w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center'>
              <Search className='w-5 h-5 text-accent' />
            </div>
            <div>
              <h2 className='font-bold text-base'>搜尋與播放</h2>
              <p className='text-xs text-zinc-500 mt-0.5'>日常使用偏好</p>
            </div>
          </div>

          <SettingToggle
            label='預設聚合搜尋結果'
            description='搜尋時預設按標題和年份聚合顯示結果'
            checked={aggregateResults}
            onChange={setAggregateResults}
          />

          <SettingToggle
            label='優選和測速'
            description='如出現播放器劫持問題可關閉'
            checked={enableOptimization}
            onChange={setEnableOptimization}
          />

          <SettingToggle
            label='流式搜尋輸出'
            description='啟用搜尋結果實時流式輸出，關閉後使用傳統一次性搜尋'
            checked={streamSearch}
            onChange={setStreamSearch}
          />

          <SettingToggle
            label='IPTV 影片瀏覽器直連'
            description='開啟 IPTV 影片瀏覽器直連時，需要自備 Allow CORS 插件'
            checked={iptvDirect}
            onChange={setIptvDirect}
          />
        </div>

        {/* 帳號：自助改密（站長與 localstorage 模式不顯示，見元件內註解） */}
        <ChangePasswordCard />

        {/* 進階：代理（預設收合，降低認知負荷） */}
        <div className='bg-white dark:bg-zinc-900/60 backdrop-blur-sm rounded-2xl border border-zinc-200 dark:border-white/5 overflow-hidden'>
          <button
            type='button'
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className='w-full flex items-center justify-between gap-3 p-6 text-left hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors'
          >
            <div className='flex items-center gap-3 min-w-0'>
              <div className='w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0'>
                <Globe className='w-5 h-5 text-accent' />
              </div>
              <div className='min-w-0'>
                <h2 className='font-bold text-base'>進階設定</h2>
                <p className='text-xs text-zinc-500 mt-0.5'>
                  豆瓣資料／圖片代理（多數情況無需調整）
                </p>
              </div>
            </div>
            <ChevronDown
              className={`w-5 h-5 text-zinc-500 flex-shrink-0 transition-transform duration-200 ${
                showAdvanced ? 'rotate-180' : ''
              }`}
              aria-hidden
            />
          </button>

          {showAdvanced && (
            <div className='px-6 pb-6 space-y-6 border-t border-zinc-200 dark:border-white/5 pt-5'>
              <div>
                <div className='flex items-center gap-2 mb-3'>
                  <Globe className='w-4 h-4 text-accent' />
                  <h3 className='font-semibold text-sm'>豆瓣資料代理</h3>
                </div>
                <div className='space-y-2'>
                  {DATA_PROXY_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200 ${
                        doubanSource === opt.value
                          ? 'bg-accent/10 border border-accent/30'
                          : 'bg-zinc-100 dark:bg-zinc-800/30 border border-transparent hover:bg-zinc-200 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <input
                        type='radio'
                        name='doubanSource'
                        value={opt.value}
                        checked={doubanSource === opt.value}
                        onChange={(e) => setDoubanSource(e.target.value)}
                        className='hidden'
                      />
                      <div
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          doubanSource === opt.value
                            ? 'border-accent'
                            : 'border-zinc-300 dark:border-zinc-600'
                        }`}
                      >
                        {doubanSource === opt.value && (
                          <div className='w-2 h-2 rounded-full bg-accent' />
                        )}
                      </div>
                      <span className='text-sm text-zinc-700 dark:text-zinc-200'>
                        {opt.label}
                      </span>
                    </label>
                  ))}
                </div>

                {doubanSource === 'custom' && (
                  <div className='mt-4'>
                    <label className='block text-xs text-zinc-500 mb-2'>
                      自定義代理 URL
                    </label>
                    <input
                      type='text'
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                      placeholder='https://your-proxy.com/'
                      className='w-full rounded-xl border border-zinc-300 dark:border-zinc-800 py-3 px-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:ring-2 focus:ring-accent/50 focus:border-accent/50 focus:outline-none bg-white dark:bg-black/40 text-sm transition-all'
                    />
                  </div>
                )}
              </div>

              <div>
                <div className='flex items-center gap-2 mb-3'>
                  <ImageIcon className='w-4 h-4 text-accent' />
                  <h3 className='font-semibold text-sm'>豆瓣圖片代理</h3>
                </div>
                <div className='space-y-2'>
                  {IMAGE_PROXY_OPTIONS.map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-all duration-200 ${
                        imageProxyType === opt.value
                          ? 'bg-accent/10 border border-accent/30'
                          : 'bg-zinc-100 dark:bg-zinc-800/30 border border-transparent hover:bg-zinc-200 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <input
                        type='radio'
                        name='imageProxyType'
                        value={opt.value}
                        checked={imageProxyType === opt.value}
                        onChange={(e) => setImageProxyType(e.target.value)}
                        className='hidden'
                      />
                      <div
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          imageProxyType === opt.value
                            ? 'border-accent'
                            : 'border-zinc-300 dark:border-zinc-600'
                        }`}
                      >
                        {imageProxyType === opt.value && (
                          <div className='w-2 h-2 rounded-full bg-accent' />
                        )}
                      </div>
                      <span className='text-sm text-zinc-700 dark:text-zinc-200'>
                        {opt.label}
                      </span>
                    </label>
                  ))}
                </div>

                {imageProxyType === 'custom' && (
                  <div className='mt-4'>
                    <label className='block text-xs text-zinc-500 mb-2'>
                      自定義代理 URL
                    </label>
                    <input
                      type='text'
                      value={imageProxyUrl}
                      onChange={(e) => setImageProxyUrl(e.target.value)}
                      placeholder='https://your-proxy.com/'
                      className='w-full rounded-xl border border-zinc-300 dark:border-zinc-800 py-3 px-4 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:ring-2 focus:ring-accent/50 focus:border-accent/50 focus:outline-none bg-white dark:bg-black/40 text-sm transition-all'
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 儲存按鈕 */}
        <button
          onClick={handleSave}
          className='w-full py-4 bg-accent text-white font-bold rounded-xl shadow-lg shadow-accent/25 hover:bg-accent/90 hover:shadow-accent/35 hover:scale-[1.01] active:scale-[0.99] transition-all duration-200 tracking-wide'
        >
          儲存設定
        </button>

        <p className='text-center text-xs text-zinc-500'>
          這些設定儲存在本地瀏覽器中
        </p>
      </div>

      {/* 儲存提示 */}
      {saveMessage && (
        <div className='fixed bottom-8 left-1/2 -translate-x-1/2 bg-accent/90 text-white px-6 py-3 rounded-xl text-sm font-medium shadow-2xl backdrop-blur-sm z-50'>
          {saveMessage}
        </div>
      )}
    </div>
  );
}
