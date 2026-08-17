'use client';

import { LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { clearUserCache } from '@/lib/db.client';
import { CURRENT_VERSION } from '@/lib/version';
import { useMounted } from '@/hooks/useClientMount';

import { VersionPanel } from './VersionPanel';

interface AuthInfo {
  username?: string;
  role?: 'owner' | 'admin' | 'user';
}

/** 角色 -> 顯示名稱 */
function getRoleLabel(role?: string): string {
  switch (role) {
    case 'owner':
      return '站長';
    case 'admin':
      return '管理員';
    case 'user':
      return '使用者';
    default:
      return '訪客';
  }
}

export function UserMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [showVersion, setShowVersion] = useState(false);
  const mounted = useMounted();
  // 首輪 SSR/hydration 期間 UI 由 mounted 旗標擋住，lazy 讀 cookie 不會造成
  // 標記不一致
  const [authInfo] = useState<AuthInfo | null>(() =>
    typeof window === 'undefined' ? null : getAuthInfoFromBrowserCookie()
  );
  const router = useRouter();

  // Click-outside detection for dropdown
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.user-menu-container')) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () =>
      document.removeEventListener('mousedown', handleClickOutside, true);
  }, [isOpen]);

  if (!mounted) return null;

  const handleAction = async (e: React.MouseEvent, type: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);

    if (type === 'settings') {
      const returnTo =
        typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}${window.location.hash}`
          : '/';
      const params = new URLSearchParams({ returnTo });
      router.push(`/settings?${params.toString()}`);
    } else if (type === 'admin') {
      router.push('/admin');
    } else if (type === 'logout' || type === 'logout-all') {
      if (
        type === 'logout-all' &&
        !window.confirm(
          '這會讓其他已登入的裝置立刻失效，確定要登出全部裝置嗎？'
        )
      ) {
        return;
      }
      try {
        const response = await fetch(
          type === 'logout-all' ? '/api/logout?all=true' : '/api/logout',
          {
            method: 'POST',
            cache: 'no-store',
          }
        );
        if (!response.ok) {
          throw new Error(`Logout failed: ${response.status}`);
        }

        clearUserCache();
        if ('caches' in window) {
          await window.caches.delete('apis');
        }
        window.location.assign('/login');
      } catch {
        window.dispatchEvent(
          new CustomEvent('globalError', {
            detail: { message: '登出失敗，請稍後再試' },
          })
        );
      }
    }
  };

  const displayRole = getRoleLabel(authInfo?.role);
  const displayName = authInfo?.username || '使用者';

  return (
    <div className='relative z-[999999] pointer-events-auto block user-menu-container'>
      {/* 頂部頭像按鈕 */}
      <div
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className='flex items-center space-x-3 cursor-pointer group select-none relative z-[999999]'
      >
        <div className='w-9 h-9 rounded-xl bg-gradient-to-br from-accent via-purple-600 to-indigo-700 flex items-center justify-center text-white shadow-lg shadow-red-500/20 transition transform group-hover:scale-110 group-hover:rotate-3 duration-200'>
          <UserRound className='w-5 h-5' />
        </div>
        <div className='hidden md:block'>
          <p className='text-sm font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-white transition'>
            {displayRole}
          </p>
          <p className='text-[10px] text-zinc-500 dark:text-zinc-500'>
            {displayName}
          </p>
        </div>
      </div>

      {/* 下拉選單 */}
      {isOpen && (
        <div
          className='absolute right-0 mt-3 w-56 rounded-2xl bg-white dark:bg-deep/95 backdrop-blur-xl border border-zinc-200 dark:border-zinc-800 p-2 shadow-2xl z-[999999]'
          onClick={(e) => e.stopPropagation()}
        >
          <div className='px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-900 select-none'>
            <p className='text-xs text-zinc-500'>目前使用者</p>
            <p className='text-sm font-bold text-zinc-900 dark:text-white truncate mt-0.5'>
              {displayName}
            </p>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 mt-1 rounded-full text-xs font-medium ${
                (authInfo?.role || 'user') === 'owner'
                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
                  : (authInfo?.role || 'user') === 'admin'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                    : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
              }`}
            >
              {displayRole}
            </span>
          </div>

          <div className='p-1 space-y-0.5 relative z-[999999]'>
            {/* 設定按鈕 */}
            <button
              onClick={(e) => handleAction(e, 'settings')}
              className='w-full flex items-center space-x-3 px-3 py-2.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-white rounded-xl text-sm transition text-left cursor-pointer relative z-[999999]'
            >
              <Settings className='w-4 h-4 text-zinc-500' />
              <span>設定</span>
            </button>

            {/* 管理面板（只有 owner / admin 才顯示）*/}
            {(authInfo?.role === 'owner' || authInfo?.role === 'admin') && (
              <button
                onClick={(e) => handleAction(e, 'admin')}
                className='w-full flex items-center space-x-3 px-3 py-2.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 hover:text-zinc-900 dark:hover:text-white rounded-xl text-sm transition text-left cursor-pointer relative z-[999999]'
              >
                <ShieldCheck className='w-4 h-4 text-zinc-500' />
                <span>管理面板</span>
              </button>
            )}

            {/* 登出 */}
            <button
              onClick={(e) => handleAction(e, 'logout')}
              className='w-full flex items-center space-x-3 px-3 py-2.5 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/20 rounded-xl text-sm transition font-medium border-t border-zinc-200 dark:border-zinc-900/50 mt-1 text-left cursor-pointer relative z-[999999]'
            >
              <LogOut className='w-4 h-4 text-red-500' />
              <span>登出</span>
            </button>
            <button
              onClick={(e) => handleAction(e, 'logout-all')}
              className='w-full flex items-center space-x-3 px-3 py-2.5 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-950/20 rounded-xl text-sm transition text-left cursor-pointer relative z-[999999]'
            >
              <LogOut className='w-4 h-4 text-red-500' />
              <span>登出所有裝置</span>
            </button>
          </div>

          {/* 底部版本號 */}
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowVersion(true);
              setIsOpen(false);
            }}
            className='mt-1 border-t border-zinc-200 dark:border-zinc-900/80 pt-2 pb-1 text-center cursor-pointer group flex items-center justify-center select-none relative z-[999999] w-full'
          >
            <span className='text-[11px] font-medium text-zinc-500 group-hover:text-accent transition tracking-wider block w-full py-1'>
              {CURRENT_VERSION}
            </span>
          </div>
        </div>
      )}

      {/* 版本資訊對話框 */}
      {showVersion && (
        <VersionPanel
          isOpen={showVersion}
          onClose={() => setShowVersion(false)}
        />
      )}
    </div>
  );
}
