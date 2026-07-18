'use client';

import { AlertCircle, CheckCircle, Eye, EyeOff, Film } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import { CURRENT_VERSION } from '@/lib/version';
import { checkForUpdates, UpdateStatus } from '@/lib/version_check';
import { useClientValue, useMounted } from '@/hooks/useClientMount';

import { useSite } from '@/components/SiteProvider';

import { getSafeLoginRedirect } from './login-redirect';

function VersionDisplay() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const status = await checkForUpdates();
        setUpdateStatus(status);
      } catch (_) {
        /* do nothing */
      } finally {
        setIsChecking(false);
      }
    };

    checkUpdate();
  }, []);

  return (
    <button
      onClick={() =>
        window.open('https://github.com/Berserker8888/LunaTV', '_blank')
      }
      className='fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 text-xs text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer z-20'
    >
      <span className='font-mono tracking-wider'>{CURRENT_VERSION}</span>
      {!isChecking && updateStatus !== UpdateStatus.FETCH_FAILED && (
        <div
          className={`flex items-center gap-1.5 ${
            updateStatus === UpdateStatus.HAS_UPDATE
              ? 'text-yellow-600'
              : updateStatus === UpdateStatus.NO_UPDATE
                ? 'text-green-600'
                : ''
          }`}
        >
          {updateStatus === UpdateStatus.HAS_UPDATE && (
            <>
              <AlertCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>有新版本</span>
            </>
          )}
          {updateStatus === UpdateStatus.NO_UPDATE && (
            <>
              <CheckCircle className='w-3.5 h-3.5' />
              <span className='font-semibold text-xs'>已是最新</span>
            </>
          )}
        </div>
      )}
    </button>
  );
}

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const shouldAskUsername = useClientValue(() => {
    const storageType = window.RUNTIME_CONFIG?.STORAGE_TYPE;
    return Boolean(storageType && storageType !== 'localstorage');
  }, false);
  const mounted = useMounted();

  const passwordRef = useRef<HTMLInputElement>(null);

  const { siteName } = useSite();

  useEffect(() => {
    const timer = setTimeout(() => passwordRef.current?.focus(), 400);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!password || (shouldAskUsername && !username)) return;

    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
        }),
      });

      if (res.ok) {
        const redirect = getSafeLoginRedirect(searchParams.get('redirect'));
        router.replace(redirect);
      } else if (res.status === 401) {
        setError('密碼錯誤');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '伺服器錯誤');
      }
    } catch {
      setError('網路錯誤，請稍後重試');
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className='relative min-h-screen flex items-center justify-center px-4 overflow-hidden bg-black'>
      {/* 動態背景 */}
      <div className='absolute inset-0'>
        <div className='absolute inset-0 bg-gradient-to-br from-accent/10 via-black to-purple-900/10' />
        <div className='absolute top-[-30%] left-[-20%] w-[80%] h-[80%] rounded-full bg-accent/5 blur-[120px]' />
        <div className='absolute bottom-[-30%] right-[-20%] w-[80%] h-[80%] rounded-full bg-purple-900/5 blur-[120px]' />
        <div className='absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-black/60 to-black' />
      </div>

      {/* 掃描線效果 */}
      <div className='absolute inset-0 opacity-[0.03] pointer-events-none'>
        <div
          className='w-full h-full'
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 2px, white 2px, white 3px)',
            backgroundSize: '100% 3px',
          }}
        />
      </div>

      <div className='relative z-10 w-full max-w-sm'>
        {/* Logo 區域 */}
        <div className='text-center mb-10'>
          <div className='inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-red-700 shadow-lg shadow-red-500/25 mb-5'>
            <Film className='w-8 h-8 text-white' />
          </div>
          <h1 className='text-4xl font-black text-white tracking-[0.15em] mb-2 drop-shadow-lg'>
            {siteName}
          </h1>
          <p className='text-zinc-500 text-xs tracking-widest uppercase'>
            影音娛樂平台
          </p>
        </div>

        {/* 登入卡片 */}
        <div className='relative bg-zinc-900/60 backdrop-blur-xl rounded-2xl p-8 border border-zinc-800/50 shadow-2xl'>
          <div className='absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent' />

          <form onSubmit={handleSubmit} className='space-y-5'>
            {shouldAskUsername && (
              <div>
                <label
                  htmlFor='username'
                  className='block text-xs font-medium text-zinc-500 mb-2 tracking-wide uppercase'
                >
                  使用者名
                </label>
                <input
                  id='username'
                  type='text'
                  autoComplete='username'
                  className='block w-full rounded-xl border border-zinc-800 py-3.5 px-4 text-white placeholder:text-zinc-600 focus:ring-2 focus:ring-accent/50 focus:border-accent/50 focus:outline-none bg-black/40 transition-all duration-200 text-sm'
                  placeholder='請輸入使用者名'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            )}

            <div>
              <label
                htmlFor='password'
                className='block text-xs font-medium text-zinc-500 mb-2 tracking-wide uppercase'
              >
                登入密碼
              </label>
              <div className='relative'>
                <input
                  id='password'
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete='current-password'
                  className='block w-full rounded-xl border border-zinc-700 py-3.5 pl-4 pr-12 text-white placeholder:text-zinc-500 focus:ring-2 focus:ring-accent/70 focus:border-accent focus:outline-none bg-black/40 transition-all duration-200 text-sm'
                  placeholder='請輸入登入密碼'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type='button'
                  onClick={() => setShowPassword((value) => !value)}
                  className='absolute inset-y-0 right-0 flex w-12 items-center justify-center text-zinc-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent'
                  aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeOff className='h-5 w-5' />
                  ) : (
                    <Eye className='h-5 w-5' />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className='flex items-center gap-2 text-sm text-accent bg-red-500/10 rounded-xl px-4 py-3 border border-red-500/20'>
                <AlertCircle className='w-4 h-4 flex-shrink-0' />
                <span>{error}</span>
              </div>
            )}

            <button
              type='submit'
              disabled={
                !password || loading || (shouldAskUsername && !username)
              }
              className='relative w-full rounded-xl bg-gradient-to-r from-accent to-red-600 py-3.5 text-base font-bold text-white shadow-lg shadow-red-500/25 transition-all duration-200 hover:shadow-red-500/40 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-none overflow-hidden group'
            >
              <span className='relative z-10 tracking-wider'>
                {loading ? (
                  <span className='flex items-center justify-center gap-2'>
                    <span className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin' />
                    登入中...
                  </span>
                ) : (
                  '登入'
                )}
              </span>
            </button>
          </form>
        </div>
      </div>

      <VersionDisplay />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className='min-h-screen bg-black flex items-center justify-center'>
          <div className='w-8 h-8 border-[3px] border-accent border-t-transparent rounded-full animate-spin' />
        </div>
      }
    >
      <LoginPageClient />
    </Suspense>
  );
}
