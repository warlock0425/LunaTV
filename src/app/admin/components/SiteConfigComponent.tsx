import { Check, ChevronDown, ExternalLink } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

import {
  AlertModal,
  showError,
  showSuccess,
  useAlertModal,
} from './AlertModal';
import { buttonStyles } from './buttonStyles';
import { useLoadingState } from './Loading';
import { SiteConfig } from './types';

// 將後端 SiteConfig 正規化為表單草稿（補預設值、相容舊代理型別）
const mapSiteConfig = (sc: AdminConfig['SiteConfig']): SiteConfig => ({
  ...sc,
  DoubanProxyType: sc.DoubanProxyType || 'cmliussss-cdn-tencent',
  DoubanProxy: sc.DoubanProxy || '',
  DoubanImageProxyType:
    sc.DoubanImageProxyType === 'direct' || sc.DoubanImageProxyType === 'img3'
      ? 'server'
      : sc.DoubanImageProxyType || 'cmliussss-cdn-tencent',
  DoubanImageProxy: sc.DoubanImageProxy || '',
  DisableYellowFilter: sc.DisableYellowFilter || false,
  FluidSearch: sc.FluidSearch ?? true,
  EnableWebLive: sc.EnableWebLive ?? false,
  PreferValidatedSourceOrder: sc.PreferValidatedSourceOrder ?? false,
});

export const SiteConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [siteSettings, setSiteSettings] = useState<SiteConfig>(() =>
    config?.SiteConfig
      ? mapSiteConfig(config.SiteConfig)
      : {
          SiteName: '',
          Announcement: '',
          SearchDownstreamMaxPage: 1,
          SiteInterfaceCacheTime: 7200,
          DoubanProxyType: 'cmliussss-cdn-tencent',
          DoubanProxy: '',
          DoubanImageProxyType: 'cmliussss-cdn-tencent',
          DoubanImageProxy: '',
          DisableYellowFilter: false,
          FluidSearch: true,
          EnableWebLive: false,
          PreferValidatedSourceOrder: false,
        }
  );

  // 豆瓣資料源相關狀態
  const [isDoubanDropdownOpen, setIsDoubanDropdownOpen] = useState(false);
  const [isDoubanImageProxyDropdownOpen, setIsDoubanImageProxyDropdownOpen] =
    useState(false);

  // 豆瓣資料源選項
  const doubanDataSourceOptions = [
    { value: 'direct', label: '直連（伺服器直接請求豆瓣）' },
    { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（騰訊雲）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里雲）' },
    { value: 'custom', label: '自定義代理' },
  ];

  // 豆瓣圖片代理選項
  const doubanImageProxyTypeOptions = [
    { value: 'server', label: '伺服器代理（由伺服器代理請求豆瓣）' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（騰訊雲）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里雲）' },
    { value: 'custom', label: '自定義代理' },
  ];

  // 取得感謝資訊
  const getThanksInfo = (dataSource: string) => {
    switch (dataSource) {
      case 'cors-proxy-zwei':
        return {
          text: 'Thanks to @Zwei',
          url: 'https://github.com/bestzwei',
        };
      case 'cmliussss-cdn-tencent':
      case 'cmliussss-cdn-ali':
        return {
          text: 'Thanks to @CMLiussss',
          url: 'https://github.com/cmliu',
        };
      default:
        return null;
    }
  };

  // config 變化時同步草稿（render 期調整狀態）
  const [prevConfig, setPrevConfig] = useState(config);
  if (config !== prevConfig) {
    setPrevConfig(config);
    if (config?.SiteConfig) {
      setSiteSettings(mapSiteConfig(config.SiteConfig));
    }
  }

  // 點擊外部區域關閉下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource"]')) {
          setIsDoubanDropdownOpen(false);
        }
      }
    };

    if (isDoubanDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanImageProxyDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-image-proxy"]')) {
          setIsDoubanImageProxyDropdownOpen(false);
        }
      }
    };

    if (isDoubanImageProxyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanImageProxyDropdownOpen]);

  // 處理豆瓣資料源變化
  const handleDoubanDataSourceChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanProxyType: value,
    }));
  };

  // 處理豆瓣圖片代理變化
  const handleDoubanImageProxyChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanImageProxyType: value,
    }));
  };

  // 儲存站點設定
  const handleSave = async () => {
    await withLoading('saveSiteConfig', async () => {
      try {
        const resp = await fetch('/api/admin/site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...siteSettings }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `儲存失敗: ${resp.status}`);
        }

        showSuccess('儲存成功, 請重新整理頁面', showAlert);
        await refreshConfig();
      } catch (err) {
        showError(err instanceof Error ? err.message : '儲存失敗', showAlert);
        throw err;
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-zinc-500 dark:text-zinc-400'>
        載入中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 站點名稱 */}
      <div>
        <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
          站點名稱
        </label>
        <input
          type='text'
          value={siteSettings.SiteName}
          onChange={(e) =>
            setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
          }
          className='w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 站點公告 */}
      <div>
        <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
          站點公告
        </label>
        <textarea
          value={siteSettings.Announcement}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              Announcement: e.target.value,
            }))
          }
          rows={3}
          className='w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 豆瓣資料源設定 */}
      <div className='space-y-3'>
        <div>
          <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
            豆瓣資料代理
          </label>
          <div className='relative' data-dropdown='douban-datasource'>
            {/* 自定義下拉選擇框 */}
            <button
              type='button'
              onClick={() => setIsDoubanDropdownOpen(!isDoubanDropdownOpen)}
              className='w-full px-3 py-2.5 pr-10 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm hover:border-zinc-400 dark:hover:border-zinc-500 text-left'
            >
              {
                doubanDataSourceOptions.find(
                  (option) => option.value === siteSettings.DoubanProxyType
                )?.label
              }
            </button>

            {/* 下拉箭頭 */}
            <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
              <ChevronDown
                className={`w-4 h-4 text-zinc-400 dark:text-zinc-500 transition-transform duration-200 ${
                  isDoubanDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </div>

            {/* 下拉選項列表 */}
            {isDoubanDropdownOpen && (
              <div className='absolute z-50 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                {doubanDataSourceOptions.map((option) => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => {
                      handleDoubanDataSourceChange(option.value);
                      setIsDoubanDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                      siteSettings.DoubanProxyType === option.value
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                        : 'text-zinc-900 dark:text-zinc-100'
                    }`}
                  >
                    <span className='truncate'>{option.label}</span>
                    {siteSettings.DoubanProxyType === option.value && (
                      <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
            選擇取得豆瓣資料的方式
          </p>

          {/* 感謝資訊 */}
          {getThanksInfo(siteSettings.DoubanProxyType) && (
            <div className='mt-3'>
              <button
                type='button'
                onClick={() =>
                  window.open(
                    getThanksInfo(siteSettings.DoubanProxyType)!.url,
                    '_blank'
                  )
                }
                className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer'
              >
                <span className='font-medium'>
                  {getThanksInfo(siteSettings.DoubanProxyType)!.text}
                </span>
                <ExternalLink className='w-3.5 opacity-70' />
              </button>
            </div>
          )}
        </div>

        {/* 豆瓣代理地址設定 - 僅在選擇自定義代理時顯示 */}
        {siteSettings.DoubanProxyType === 'custom' && (
          <div>
            <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
              豆瓣代理地址
            </label>
            <input
              type='text'
              placeholder='例如: https://proxy.example.com/fetch?url='
              value={siteSettings.DoubanProxy}
              onChange={(e) =>
                setSiteSettings((prev) => ({
                  ...prev,
                  DoubanProxy: e.target.value,
                }))
              }
              className='w-full px-3 py-2.5 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-400 shadow-sm hover:border-zinc-400 dark:hover:border-zinc-500'
            />
            <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
              自定義代理伺服器地址
            </p>
          </div>
        )}
      </div>

      {/* 豆瓣圖片代理設定 */}
      <div className='space-y-3'>
        <div>
          <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
            豆瓣圖片代理
          </label>
          <div className='relative' data-dropdown='douban-image-proxy'>
            {/* 自定義下拉選擇框 */}
            <button
              type='button'
              onClick={() =>
                setIsDoubanImageProxyDropdownOpen(
                  !isDoubanImageProxyDropdownOpen
                )
              }
              className='w-full px-3 py-2.5 pr-10 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm hover:border-zinc-400 dark:hover:border-zinc-500 text-left'
            >
              {
                doubanImageProxyTypeOptions.find(
                  (option) => option.value === siteSettings.DoubanImageProxyType
                )?.label
              }
            </button>

            {/* 下拉箭頭 */}
            <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
              <ChevronDown
                className={`w-4 h-4 text-zinc-400 dark:text-zinc-500 transition-transform duration-200 ${
                  isDoubanImageProxyDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </div>

            {/* 下拉選項列表 */}
            {isDoubanImageProxyDropdownOpen && (
              <div className='absolute z-50 w-full mt-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                {doubanImageProxyTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => {
                      handleDoubanImageProxyChange(option.value);
                      setIsDoubanImageProxyDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-zinc-100 dark:hover:bg-zinc-700 ${
                      siteSettings.DoubanImageProxyType === option.value
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                        : 'text-zinc-900 dark:text-zinc-100'
                    }`}
                  >
                    <span className='truncate'>{option.label}</span>
                    {siteSettings.DoubanImageProxyType === option.value && (
                      <Check className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 ml-2' />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
            選擇取得豆瓣圖片的方式
          </p>

          {/* 感謝資訊 */}
          {getThanksInfo(siteSettings.DoubanImageProxyType) && (
            <div className='mt-3'>
              <button
                type='button'
                onClick={() =>
                  window.open(
                    getThanksInfo(siteSettings.DoubanImageProxyType)!.url,
                    '_blank'
                  )
                }
                className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-zinc-500 dark:text-zinc-400 cursor-pointer'
              >
                <span className='font-medium'>
                  {getThanksInfo(siteSettings.DoubanImageProxyType)!.text}
                </span>
                <ExternalLink className='w-3.5 opacity-70' />
              </button>
            </div>
          )}
        </div>

        {/* 豆瓣代理地址設定 - 僅在選擇自定義代理時顯示 */}
        {siteSettings.DoubanImageProxyType === 'custom' && (
          <div>
            <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
              豆瓣圖片代理地址
            </label>
            <input
              type='text'
              placeholder='例如: https://proxy.example.com/fetch?url='
              value={siteSettings.DoubanImageProxy}
              onChange={(e) =>
                setSiteSettings((prev) => ({
                  ...prev,
                  DoubanImageProxy: e.target.value,
                }))
              }
              className='w-full px-3 py-2.5 border border-zinc-300 dark:border-zinc-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-400 shadow-sm hover:border-zinc-400 dark:hover:border-zinc-500'
            />
            <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
              自定義圖片代理伺服器地址
            </p>
          </div>
        )}
      </div>

      {/* 搜尋接口可取得最大頁數：熱路徑固定只打第 1 頁，此值不再生效 */}
      <div>
        <label className='block text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2'>
          搜尋接口可取得最大頁數
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SearchDownstreamMaxPage}
          disabled
          readOnly
          className='w-full px-3 py-2 border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-100 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 cursor-not-allowed'
        />
        <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
          搜尋熱路徑固定只打每個源的第 1
          頁，此設定目前不生效。存檔仍會保留原值，以免舊設定被清掉。
        </p>
      </div>

      {/* 站點接口快取時間 */}
      <div>
        <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
          站點接口快取時間（秒）
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SiteInterfaceCacheTime}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SiteInterfaceCacheTime: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 禁用黃色過濾器 */}
      <div>
        <div className='flex items-center justify-between'>
          <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
            禁用黃色過濾器
          </label>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                DisableYellowFilter: !prev.DisableYellowFilter,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              siteSettings.DisableYellowFilter
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full ${
                buttonStyles.toggleThumb
              } transition-transform ${
                siteSettings.DisableYellowFilter
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
          禁用黃色內容的過濾功能，允許顯示所有內容。
        </p>
      </div>

      {/* 流式搜尋 */}
      <div>
        <div className='flex items-center justify-between'>
          <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
            啟用流式搜尋
          </label>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                FluidSearch: !prev.FluidSearch,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              siteSettings.FluidSearch
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full ${
                buttonStyles.toggleThumb
              } transition-transform ${
                siteSettings.FluidSearch
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
          啟用後搜尋結果將實時流式返回，提昇使用者體驗。
        </p>
      </div>

      {/* 啟用網頁直播 */}
      <div>
        <div className='flex items-center justify-between'>
          <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
            啟用網頁直播
          </label>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                EnableWebLive: !prev.EnableWebLive,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              siteSettings.EnableWebLive
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full ${
                buttonStyles.toggleThumb
              } transition-transform ${
                siteSettings.EnableWebLive
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
          關閉後停用瀏覽器直播頁與直播 proxy，減少伺服器轉發。Selene／Selene-TV
          登入後仍可讀直播源列表，在裝置上直連播放。
        </p>
      </div>

      {/* 依三級檢測排序搜尋來源（預設關） */}
      <div>
        <div className='flex items-center justify-between'>
          <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2'>
            搜尋時優先使用檢測較佳的源
          </label>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                PreferValidatedSourceOrder: !prev.PreferValidatedSourceOrder,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              siteSettings.PreferValidatedSourceOrder
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full ${
                buttonStyles.toggleThumb
              } transition-transform ${
                siteSettings.PreferValidatedSourceOrder
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-zinc-500 dark:text-zinc-400'>
          開啟後會依最近「三級有效性檢測」結果調整搜尋順序；不自動停用任何來源。未檢測過的源維持中等優先。
        </p>
      </div>

      {/* 操作按鈕 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={isLoading('saveSiteConfig')}
          className={`px-4 py-2 ${
            isLoading('saveSiteConfig')
              ? buttonStyles.disabled
              : buttonStyles.success
          } rounded-lg transition-colors`}
        >
          {isLoading('saveSiteConfig') ? '儲存中…' : '儲存'}
        </button>
      </div>

      {/* 通用彈窗組件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};
