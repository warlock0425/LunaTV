'use client';

import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { useMounted } from '@/hooks/useClientMount';

import { getClientStorageType } from '@/app/play/play-page-helpers';

/** 改密成功後伺服器已撤銷所有 session，停在原頁只會一路 401，所以導回登入 */
const REDIRECT_DELAY_MS = 1500;

export default function ChangePasswordCard() {
  const router = useRouter();
  const mounted = useMounted();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  // cookie 與 RUNTIME_CONFIG 都只有瀏覽器端有，首輪 render 一律不顯示，
  // 避免 hydration 前後不一致
  if (!mounted) return null;

  // 本地存儲模式全站共用一組 PASSWORD，沒有「每個人的密碼」可改
  if (getClientStorageType() === 'localstorage') return null;

  // 站長帳密來自環境變數，不在資料庫；API 也會擋（403）
  if (getAuthInfoFromBrowserCookie()?.role === 'owner') {
    return (
      <div className='bg-white dark:bg-zinc-900/60 backdrop-blur-sm rounded-2xl border border-zinc-200 dark:border-white/5 p-6'>
        <div className='flex items-center gap-3'>
          <div className='w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0'>
            <KeyRound className='w-5 h-5 text-accent' />
          </div>
          <div className='min-w-0'>
            <h2 className='font-bold text-base'>修改密碼</h2>
            <p className='text-xs text-zinc-500 mt-0.5'>
              站長密碼由部署環境變數 PASSWORD
              控制，無法於線上修改。請改部署設定後重啟服務。
            </p>
          </div>
        </div>
      </div>
    );
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || done) return;

    if (!currentPassword || !newPassword) {
      setError('請填寫目前密碼與新密碼');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('兩次輸入的新密碼不一致');
      return;
    }
    if (newPassword === currentPassword) {
      setError('新密碼與目前密碼相同');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error || `修改失敗（${response.status}）`);
        return;
      }

      setDone(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      redirectTimerRef.current = setTimeout(() => {
        router.replace('/login');
      }, REDIRECT_DELAY_MS);
    } catch {
      setError('修改失敗，請稍後再試');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-white/10 text-sm outline-none focus:border-accent transition-colors';

  return (
    <div className='bg-white dark:bg-zinc-900/60 backdrop-blur-sm rounded-2xl border border-zinc-200 dark:border-white/5 p-6'>
      <div className='flex items-center gap-3 mb-5'>
        <div className='w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0'>
          <KeyRound className='w-5 h-5 text-accent' />
        </div>
        <div className='min-w-0'>
          <h2 className='font-bold text-base'>修改密碼</h2>
          <p className='text-xs text-zinc-500 mt-0.5'>
            修改後所有已登入的裝置都需要重新登入
          </p>
        </div>
      </div>

      {done ? (
        <p className='text-sm text-green-600 dark:text-green-400'>
          密碼已更新，正在導向登入頁…
        </p>
      ) : (
        <form onSubmit={submit} className='space-y-4'>
          <div>
            <label
              htmlFor='current-password'
              className='block text-sm font-medium mb-1.5'
            >
              目前密碼
            </label>
            <input
              id='current-password'
              type='password'
              autoComplete='current-password'
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor='new-password'
              className='block text-sm font-medium mb-1.5'
            >
              新密碼
            </label>
            <input
              id='new-password'
              type='password'
              autoComplete='new-password'
              maxLength={128}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          <div>
            <label
              htmlFor='confirm-password'
              className='block text-sm font-medium mb-1.5'
            >
              確認新密碼
            </label>
            <input
              id='confirm-password'
              type='password'
              autoComplete='new-password'
              maxLength={128}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && (
            <p role='alert' className='text-sm text-red-600 dark:text-red-400'>
              {error}
            </p>
          )}

          <button
            type='submit'
            disabled={submitting}
            className='px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium disabled:opacity-50 transition-opacity'
          >
            {submitting ? '修改中…' : '修改密碼'}
          </button>
        </form>
      )}
    </div>
  );
}
