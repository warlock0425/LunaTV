import React, { useState } from 'react';

import { AdminConfig } from '@/lib/admin.types';

import {
  AlertModal,
  showError,
  showSuccess,
  useAlertModal,
} from './AlertModal';
import { buttonStyles } from './buttonStyles';
import { useLoadingState } from './Loading';

export const ConfigFileComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [configContent, setConfigContent] = useState(config?.ConfigFile ?? '');
  const [subscriptionUrl, setSubscriptionUrl] = useState(
    config?.ConfigSubscription?.URL ?? ''
  );
  const [autoUpdate, setAutoUpdate] = useState(
    config?.ConfigSubscription?.AutoUpdate ?? false
  );
  const [lastCheckTime, setLastCheckTime] = useState<string>(
    config?.ConfigSubscription?.LastCheck ?? ''
  );

  // config 變化時同步草稿（render 期調整狀態）
  const [prevConfig, setPrevConfig] = useState(config);
  if (config !== prevConfig) {
    setPrevConfig(config);
    setConfigContent(config?.ConfigFile ?? '');
    if (config?.ConfigSubscription) {
      setSubscriptionUrl(config.ConfigSubscription.URL);
      setAutoUpdate(config.ConfigSubscription.AutoUpdate);
      setLastCheckTime(config.ConfigSubscription.LastCheck || '');
    }
  }

  // 取得訂閱設定
  const handleFetchConfig = async () => {
    if (!subscriptionUrl.trim()) {
      showError('請輸入訂閱URL', showAlert);
      return;
    }

    await withLoading('fetchConfig', async () => {
      try {
        const resp = await fetch('/api/admin/config_subscription/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: subscriptionUrl }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `取得失敗: ${resp.status}`);
        }

        const data = await resp.json();
        if (data.configContent) {
          setConfigContent(data.configContent);
          // 更新本地設定的最後檢查時間
          const currentTime = new Date().toISOString();
          setLastCheckTime(currentTime);
          showSuccess('設定取得成功', showAlert);
        } else {
          showError('取得失敗：未取得設定內容', showAlert);
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : '取得失敗', showAlert);
        throw err;
      }
    });
  };

  // 儲存設定檔
  const handleSave = async () => {
    await withLoading('saveConfig', async () => {
      try {
        const resp = await fetch('/api/admin/config_file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            configFile: configContent,
            subscriptionUrl,
            autoUpdate,
            lastCheckTime: lastCheckTime || new Date().toISOString(),
          }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `儲存失敗: ${resp.status}`);
        }

        showSuccess('設定檔儲存成功', showAlert);
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
    <div className='space-y-4'>
      {/* 設定訂閱區域 */}
      <div className='bg-white dark:bg-zinc-800 rounded-lg p-6 border border-zinc-200 dark:border-zinc-700 shadow-sm'>
        <div className='flex items-center justify-between mb-6'>
          <h3 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100'>
            設定訂閱
          </h3>
          <div className='text-sm text-zinc-500 dark:text-zinc-400 px-3 py-1.5 rounded-full'>
            最後更新:{' '}
            {lastCheckTime
              ? new Date(lastCheckTime).toLocaleString('zh-CN')
              : '從未更新'}
          </div>
        </div>

        <div className='space-y-6'>
          {/* 訂閱URL輸入 */}
          <div>
            <label className='block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-3'>
              訂閱URL
            </label>
            <input
              type='url'
              value={subscriptionUrl}
              onChange={(e) => setSubscriptionUrl(e.target.value)}
              placeholder='https://example.com/config.json'
              disabled={false}
              className='w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200 shadow-sm hover:border-zinc-400 dark:hover:border-zinc-500'
            />
            <p className='mt-2 text-xs text-zinc-500 dark:text-zinc-400'>
              輸入設定檔的訂閱地址，要求 JSON 格式，且使用 Base58 編碼
            </p>
          </div>

          {/* 取得設定按鈕 */}
          <div className='pt-2'>
            <button
              onClick={handleFetchConfig}
              disabled={isLoading('fetchConfig') || !subscriptionUrl.trim()}
              className={`w-full px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                isLoading('fetchConfig') || !subscriptionUrl.trim()
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('fetchConfig') ? (
                <div className='flex items-center justify-center gap-2'>
                  <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                  取得中…
                </div>
              ) : (
                '取得設定'
              )}
            </button>
          </div>

          {/* 自動更新開關 */}
          <div className='flex items-center justify-between'>
            <div>
              <label className='text-sm font-medium text-zinc-700 dark:text-zinc-300'>
                自動更新
              </label>
              <p className='text-xs text-zinc-500 dark:text-zinc-400 mt-1'>
                啟用後系統將定期自動取得最新設定
              </p>
            </div>
            <button
              type='button'
              onClick={() => setAutoUpdate(!autoUpdate)}
              disabled={false}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                autoUpdate ? buttonStyles.toggleOn : buttonStyles.toggleOff
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full ${
                  buttonStyles.toggleThumb
                } transition-transform ${
                  autoUpdate
                    ? buttonStyles.toggleThumbOn
                    : buttonStyles.toggleThumbOff
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 設定檔編輯區域 */}
      <div className='space-y-4'>
        <div className='relative'>
          <textarea
            value={configContent}
            onChange={(e) => setConfigContent(e.target.value)}
            rows={20}
            placeholder='請輸入設定檔內容（JSON 格式）...'
            disabled={false}
            className='w-full px-4 py-3 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono text-sm leading-relaxed resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 hover:border-zinc-400 dark:hover:border-zinc-500'
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
            }}
            spellCheck={false}
            data-gramm={false}
          />
        </div>

        <div className='flex items-center justify-between'>
          <div className='text-xs text-zinc-500 dark:text-zinc-400'>
            支援 JSON 格式，用於設定影片源和自定義分類
          </div>
          <button
            onClick={handleSave}
            disabled={isLoading('saveConfig')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              isLoading('saveConfig')
                ? buttonStyles.disabled
                : buttonStyles.success
            }`}
          >
            {isLoading('saveConfig') ? '儲存中…' : '儲存'}
          </button>
        </div>
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
