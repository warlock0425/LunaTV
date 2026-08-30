'use client';

import {
  Database,
  FileText,
  FolderOpen,
  Settings,
  Tv,
  Users,
  Video,
} from 'lucide-react';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig, AdminConfigResult } from '@/lib/admin.types';
import { readErrorMessage } from '@/lib/safe-json';

import DataMigration from '@/components/DataMigration';
import PageLayout from '@/components/PageLayout';
import PageLoading from '@/components/PageLoading';

import {
  AlertModal,
  showError,
  showSuccess,
  useAlertModal,
} from './components/AlertModal';
import { buttonStyles } from './components/buttonStyles';
import { CategoryConfig } from './components/CategoryConfig';
import { CollapsibleTab } from './components/CollapsibleTab';
import { ConfigFileComponent } from './components/ConfigFileComponent';
import { LiveSourceConfig } from './components/LiveSourceConfig';
import { useLoadingState } from './components/Loading';
import { PlayStatsPanel } from './components/PlayStatsPanel';
import { SiteConfigComponent } from './components/SiteConfigComponent';
import { UserConfig } from './components/UserConfig';
import { VideoSourceConfig } from './components/VideoSourceConfig';

function AdminPageClient() {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [showResetConfigModal, setShowResetConfigModal] = useState(false);
  const [expandedTabs, setExpandedTabs] = useState<{ [key: string]: boolean }>({
    userConfig: false,
    videoSource: false,
    liveSource: false,
    siteConfig: false,
    categoryConfig: false,
    configFile: false,
    dataMigration: false,
    playStats: false,
  });

  // 取得管理員設定
  // showLoading 用於控製是否在請求期間顯示整體載入骨架。
  const fetchConfig = useCallback(async (showLoading = false) => {
    try {
      setError(null);
      if (showLoading) {
        setLoading(true);
      }

      const response = await fetch(`/api/admin/config`);

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, '取得設定失敗'));
      }

      const data = (await response.json()) as AdminConfigResult;
      setConfig(data.Config);
      setRole(data.Role);
      setError(null);
    } catch (err) {
      // 錯誤已由頁面上的紅字與「重新載入」按鈕呈現，
      // 不再另外彈出對話框（同一句話出現兩次且需多一次點擊才能關閉）
      const msg = err instanceof Error ? err.message : '取得設定失敗';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 首次載入骨架由 loading 初始值 true 提供，不需 showLoading
    // 掛載時抓取資料：setState 皆發生於 await 之後，規則對具名函式為保守誤判
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConfig();
  }, [fetchConfig]);

  // 切換標籤展開狀態
  const toggleTab = (tabKey: string) => {
    setExpandedTabs((prev) => ({
      ...prev,
      [tabKey]: !prev[tabKey],
    }));
  };

  // 新增: 重置設定處理函數
  const handleResetConfig = () => {
    setShowResetConfigModal(true);
  };

  const handleConfirmResetConfig = async () => {
    await withLoading('resetConfig', async () => {
      try {
        const response = await fetch(`/api/admin/reset`, {
          method: 'POST',
        });
        if (!response.ok) {
          throw new Error(`重置失敗: ${response.status}`);
        }
        showSuccess('重置成功，請重新整理頁面！', showAlert);
        await fetchConfig();
        setShowResetConfigModal(false);
      } catch (err) {
        showError(err instanceof Error ? err.message : '重置失敗', showAlert);
        throw err;
      }
    });
  };

  if (loading) {
    return (
      <PageLayout activePath='/admin'>
        <div className='px-2 sm:px-10 py-4 sm:py-8'>
          <div className='max-w-[95%] mx-auto'>
            <h1 className='text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-8'>
              管理員設定
            </h1>
            <div className='space-y-4'>
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className='h-20 bg-zinc-200 dark:bg-zinc-700 rounded-lg animate-pulse'
                />
              ))}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/admin'>
        <div className='flex min-h-[60vh] items-center justify-center px-4'>
          <div className='text-center'>
            <p className='mb-4 text-red-500'>{error}</p>
            <button
              type='button'
              onClick={() => fetchConfig(true)}
              className={buttonStyles.primary}
            >
              重新載入
            </button>
          </div>
        </div>
        <AlertModal
          isOpen={alertModal.isOpen}
          onClose={hideAlert}
          type={alertModal.type}
          title={alertModal.title}
          message={alertModal.message}
          timer={alertModal.timer}
          showConfirm={alertModal.showConfirm}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/admin'>
      <div className='px-2 sm:px-10 py-4 sm:py-8'>
        <div className='max-w-[95%] mx-auto'>
          {role === 'owner' && (
            <div className='mb-4 flex justify-end'>
              <a
                href='/admin/health'
                className='rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700'
              >
                系統健康
              </a>
            </div>
          )}
          {/* 標題 + 重置設定按鈕 */}
          <div className='flex items-center gap-2 mb-8'>
            <h1 className='text-2xl font-bold text-zinc-900 dark:text-zinc-100'>
              管理員設定
            </h1>
            {config && role === 'owner' && (
              <button
                onClick={handleResetConfig}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${buttonStyles.dangerSmall}`}
              >
                重置設定
              </button>
            )}
          </div>

          {/* 設定檔標籤 - 僅站長可見 */}
          {role === 'owner' && (
            <CollapsibleTab
              title='設定檔'
              icon={
                <FileText
                  size={20}
                  className='text-zinc-600 dark:text-zinc-400'
                />
              }
              isExpanded={expandedTabs.configFile}
              onToggle={() => toggleTab('configFile')}
            >
              <ConfigFileComponent
                config={config}
                refreshConfig={fetchConfig}
              />
            </CollapsibleTab>
          )}

          {/* 站點設定標籤 */}
          <CollapsibleTab
            title='站點設定'
            icon={
              <Settings
                size={20}
                className='text-zinc-600 dark:text-zinc-400'
              />
            }
            isExpanded={expandedTabs.siteConfig}
            onToggle={() => toggleTab('siteConfig')}
          >
            <SiteConfigComponent config={config} refreshConfig={fetchConfig} />
          </CollapsibleTab>

          <div className='space-y-4'>
            {/* 使用者設定標籤 */}
            <CollapsibleTab
              title='使用者設定'
              icon={
                <Users size={20} className='text-zinc-600 dark:text-zinc-400' />
              }
              isExpanded={expandedTabs.userConfig}
              onToggle={() => toggleTab('userConfig')}
            >
              <UserConfig
                config={config}
                role={role}
                refreshConfig={fetchConfig}
              />
            </CollapsibleTab>

            {/* 影片源設定標籤 */}
            <CollapsibleTab
              title='影片源設定'
              icon={
                <Video size={20} className='text-zinc-600 dark:text-zinc-400' />
              }
              isExpanded={expandedTabs.videoSource}
              onToggle={() => toggleTab('videoSource')}
            >
              <VideoSourceConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 直播源設定標籤 */}
            <CollapsibleTab
              title='直播源設定'
              icon={
                <Tv size={20} className='text-zinc-600 dark:text-zinc-400' />
              }
              isExpanded={expandedTabs.liveSource}
              onToggle={() => toggleTab('liveSource')}
            >
              <LiveSourceConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 分類設定標籤 */}
            <CollapsibleTab
              title='分類設定'
              icon={
                <FolderOpen
                  size={20}
                  className='text-zinc-600 dark:text-zinc-400'
                />
              }
              isExpanded={expandedTabs.categoryConfig}
              onToggle={() => toggleTab('categoryConfig')}
            >
              <CategoryConfig config={config} refreshConfig={fetchConfig} />
            </CollapsibleTab>

            {/* 資料遷移標籤 - 僅站長可見 */}
            {role === 'owner' && (
              <CollapsibleTab
                title='資料遷移'
                icon={
                  <Database
                    size={20}
                    className='text-zinc-600 dark:text-zinc-400'
                  />
                }
                isExpanded={expandedTabs.dataMigration}
                onToggle={() => toggleTab('dataMigration')}
              >
                <DataMigration onRefreshConfig={fetchConfig} />
              </CollapsibleTab>
            )}

            {/* 播放統計標籤 - owner 和 admin 可見 */}
            <CollapsibleTab
              title='播放統計'
              icon={
                <Video size={20} className='text-zinc-600 dark:text-zinc-400' />
              }
              isExpanded={expandedTabs.playStats}
              onToggle={() => toggleTab('playStats')}
            >
              <PlayStatsPanel />
            </CollapsibleTab>
          </div>
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

      {/* 重置設定確認彈窗 */}
      {showResetConfigModal &&
        createPortal(
          <div
            className='fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4'
            onClick={() => setShowResetConfigModal(false)}
          >
            <div
              className='bg-white dark:bg-zinc-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-zinc-900 dark:text-zinc-100'>
                    確認重置設定
                  </h3>
                  <button
                    onClick={() => setShowResetConfigModal(false)}
                    className='text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='mb-6'>
                  <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-yellow-600 dark:text-yellow-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-yellow-800 dark:text-yellow-300'>
                        ⚠️ 危險操作警告
                      </span>
                    </div>
                    <p className='text-sm text-yellow-700 dark:text-yellow-400'>
                      此操作將重置使用者封禁和管理員設定、自定義影片源，站點設定將重置為預設值，是否繼續？
                    </p>
                  </div>
                </div>

                {/* 操作按鈕 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => setShowResetConfigModal(false)}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmResetConfig}
                    disabled={isLoading('resetConfig')}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading('resetConfig')
                        ? buttonStyles.disabled
                        : buttonStyles.danger
                    }`}
                  >
                    {isLoading('resetConfig') ? '重置中...' : '確認重置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </PageLayout>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <AdminPageClient />
    </Suspense>
  );
}
