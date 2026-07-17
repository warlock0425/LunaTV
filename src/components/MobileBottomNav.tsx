'use client';

import {
  BookMarked,
  Cat,
  Clock,
  Clover,
  Film,
  Home,
  Menu,
  Radio,
  Search,
  Settings,
  Star,
  Tv,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import { useAccessibleDialog } from '@/hooks/useAccessibleDialog';
import { useClientValue } from '@/hooks/useClientMount';

interface MobileBottomNavProps {
  activePath?: string;
}

const MAIN_ITEMS = [
  { icon: Home, label: '首頁', href: '/' },
  { icon: Search, label: '搜尋', href: '/search' },
  { icon: Film, label: '電影', href: '/douban?type=movie' },
  { icon: Tv, label: '劇集', href: '/douban?type=tv' },
];

const BASE_MORE_ITEMS = [
  { icon: Cat, label: '動漫', href: '/douban?type=anime' },
  { icon: Clover, label: '綜藝', href: '/douban?type=show' },
  { icon: BookMarked, label: '收藏夾', href: '/?tab=favorites' },
  { icon: Clock, label: '觀看記錄', href: '/history' },
  { icon: Settings, label: '本機設定', href: '/settings' },
];

export default function MobileBottomNav({ activePath }: MobileBottomNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [moreOpen, setMoreOpen] = useState(false);
  const liveEnabled = useClientValue(
    () => Boolean(window.RUNTIME_CONFIG?.ENABLE_WEB_LIVE),
    false
  );
  const customEnabled = useClientValue(
    () => Boolean(window.RUNTIME_CONFIG?.CUSTOM_CATEGORIES?.length),
    false
  );
  const moreDialogRef = useRef<HTMLElement>(null);

  useAccessibleDialog(moreOpen, moreDialogRef, () => setMoreOpen(false));

  // 路由變化時關閉更多選單（render 期調整狀態）
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [prevRouteKey, setPrevRouteKey] = useState(routeKey);
  if (routeKey !== prevRouteKey) {
    setPrevRouteKey(routeKey);
    if (moreOpen) setMoreOpen(false);
  }

  const moreItems = useMemo(() => {
    const items = [...BASE_MORE_ITEMS];
    if (liveEnabled)
      items.unshift({ icon: Radio, label: '直播', href: '/live' });
    if (customEnabled)
      items.unshift({
        icon: Star,
        label: '自訂分類',
        href: '/douban?type=custom',
      });
    return items;
  }, [customEnabled, liveEnabled]);

  const current =
    activePath && activePath !== '/'
      ? activePath
      : `${pathname}${searchParams.size ? `?${searchParams}` : ''}`;
  const isActive = (href: string) => {
    const type = href.match(/type=([^&]+)/)?.[1];
    return (
      current === href ||
      (type !== undefined &&
        current.startsWith('/douban') &&
        current.includes(`type=${type}`))
    );
  };
  const moreActive = moreItems.some((item) => isActive(item.href));

  return (
    <>
      {moreOpen && (
        <div className='fixed inset-0 z-[590] md:hidden'>
          <button
            type='button'
            className='absolute inset-0 bg-black/70 backdrop-blur-sm'
            onClick={() => setMoreOpen(false)}
            aria-label='關閉更多選單'
          />
          <section
            ref={moreDialogRef}
            tabIndex={-1}
            role='dialog'
            aria-modal='true'
            aria-labelledby='mobile-more-title'
            className='absolute inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] rounded-2xl border border-zinc-700 bg-zinc-950 p-4 text-white shadow-2xl'
          >
            <div className='mb-3 flex items-center justify-between'>
              <h2 id='mobile-more-title' className='font-bold'>
                更多功能
              </h2>
              <button
                type='button'
                onClick={() => setMoreOpen(false)}
                className='flex h-11 w-11 items-center justify-center rounded-full hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-accent'
                aria-label='關閉更多選單'
              >
                <X className='h-5 w-5' />
              </button>
            </div>
            <div className='grid grid-cols-3 gap-2'>
              {moreItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    isActive(item.href)
                      ? 'bg-accent/20 text-accent'
                      : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <item.icon className='h-6 w-6' />
                  {item.label}
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}

      <nav className='pwa-safe-bottom fixed inset-x-0 bottom-0 z-[600] border-t border-zinc-300/80 bg-zinc-50/95 text-zinc-900 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-accent/20 dark:bg-anime-dark/95 dark:text-zinc-100 md:hidden'>
        <ul className='grid h-14 grid-cols-5'>
          {MAIN_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex h-14 flex-col items-center justify-center gap-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                    active
                      ? 'bg-zinc-800 font-bold text-white after:absolute after:inset-x-1/4 after:top-0 after:h-0.5 after:rounded-full after:bg-white'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  <item.icon className='h-6 w-6' />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type='button'
              onClick={() => setMoreOpen((value) => !value)}
              aria-expanded={moreOpen}
              className={`relative flex h-14 w-full flex-col items-center justify-center gap-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                moreOpen || moreActive
                  ? 'bg-zinc-800 font-bold text-white after:absolute after:inset-x-1/4 after:top-0 after:h-0.5 after:rounded-full after:bg-white'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <Menu className='h-6 w-6' />
              更多
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
