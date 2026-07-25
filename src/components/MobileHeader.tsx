'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BackButton } from './BackButton';
import { useSite } from './SiteProvider';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();
  const pathname = usePathname();
  return (
    <header className='md:hidden fixed top-0 left-0 right-0 z-[999] w-full bg-zinc-50/92 dark:bg-anime-dark/95 backdrop-blur-xl border-b border-zinc-300/80 dark:border-accent/20 shadow-sm dark:shadow-[0_2px_15px_rgba(0,229,255,0.05)] text-zinc-900 dark:text-zinc-100'>
      <div className='h-12 flex items-center justify-between px-4'>
        {/* 左側：搜索按鈕、返回按鈕和設置按鈕 */}
        <div className='flex items-center gap-2'>
          {pathname !== '/search' ? (
            <Link
              href='/search'
              aria-label='前往搜尋'
              title='搜尋'
              className='w-10 h-10 p-2 rounded-full flex items-center justify-center text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800/50 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
            >
              <svg
                className='w-full h-full'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                />
              </svg>
            </Link>
          ) : (
            <span className='h-10 w-10' aria-hidden='true' />
          )}
          {showBackButton && <BackButton />}
        </div>

        {/* 右側按鈕 */}
        {/* 本站以 ThemeProvider 的 forcedTheme='dark' 固定為深色，
            主題切換鈕按了不會有任何效果，故移除以免誤導。 */}
        <div className='flex items-center gap-2'>
          <UserMenu />
        </div>
      </div>

      {/* 中間：Logo（絕對居中） */}
      <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
        <Link
          href='/'
          // 加上內距讓可點高度達 40px（原本僅 29px）。標頭本身高 48px，
          // 且此區塊為絕對置中，補內距不會影響版面。
          className='inline-flex items-center px-2 py-1.5 text-2xl font-black text-zinc-900 dark:text-zinc-100 dark:drop-shadow-[0_0_8px_rgba(0,229,255,0.8)] font-[Impact] tracking-wider hover:opacity-80 transition-opacity'
        >
          {siteName}
        </Link>
      </div>
    </header>
  );
};

export default MobileHeader;
