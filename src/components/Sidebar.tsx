/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import {
  BookMarked,
  Cat,
  Clock,
  Clover,
  Film,
  Home,
  MonitorPlay,
  Radio,
  Search,
  Star,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useMemo, useState } from 'react';

import { CURRENT_VERSION } from '@/lib/version';
import { useClientValue } from '@/hooks/useClientMount';

interface SidebarContextType {
  isCollapsed: boolean;
}

const SidebarContext = createContext<SidebarContextType>({
  isCollapsed: false,
});

const NavLink = ({
  href,
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  href: string;
  icon: any;
  label: string;
  isActive: boolean;
  onClick?: (e: any) => void;
}) => (
  <Link
    href={href}
    onClick={onClick}
    className={`relative flex flex-col items-center justify-center gap-1 rounded-xl border border-transparent px-2 py-2.5 transition-all duration-300 group ${
      isActive
        ? 'bg-zinc-800 border-accent/30 text-zinc-100 dark:text-zinc-100 shadow-[inset_0_0_12px_rgba(0,229,255,0.15)]'
        : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-white/5 opacity-80 hover:opacity-100'
    }`}
  >
    {isActive && (
      <div className='absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-white rounded-r-full shadow-[0_0_10px_rgba(0,229,255,0.8)]' />
    )}
    <div className='w-6 h-6 flex items-center justify-center flex-shrink-0 transition-transform duration-300 group-hover:scale-110'>
      <Icon className='w-5 h-5' />
    </div>
    <span
      className={`text-[11px] leading-tight text-center whitespace-nowrap font-medium transition-colors duration-300 ${
        isActive
          ? 'text-zinc-100 dark:text-zinc-100 font-bold'
          : 'text-zinc-500 dark:text-zinc-400'
      }`}
    >
      {label}
    </span>
  </Link>
);

interface SidebarProps {
  onToggle?: (collapsed: boolean) => void;
  activePath?: string;
}

const Sidebar = ({ activePath = '/' }: SidebarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const currentPath =
    activePath || (queryString ? `${pathname}?${queryString}` : pathname);

  // 路由變化時同步 active（render 期調整狀態，取代 setState-in-effect）；
  // onClick 仍可搶先 setActive 以獲得即時高亮
  const [active, setActive] = useState(currentPath);
  const [prevPath, setPrevPath] = useState(currentPath);
  if (currentPath !== prevPath) {
    setPrevPath(currentPath);
    setActive(currentPath);
  }

  const handleSearchClick = () => {
    router.push('/search');
  };

  const contextValue = { isCollapsed: true };

  const showLive = useClientValue(
    () => Boolean(window.RUNTIME_CONFIG?.ENABLE_WEB_LIVE),
    false
  );
  const showCustom = useClientValue(
    () => Boolean(window.RUNTIME_CONFIG?.CUSTOM_CATEGORIES?.length),
    false
  );
  const menuItems = useMemo(() => {
    const items = [
      { icon: Film, label: '電影', href: '/douban?type=movie' },
      { icon: Tv, label: '劇集', href: '/douban?type=tv' },
      { icon: Cat, label: '動漫', href: '/douban?type=anime' },
      { icon: Clover, label: '綜藝', href: '/douban?type=show' },
    ];
    if (showLive) {
      items.push({ icon: Radio, label: '直播', href: '/live' });
    }
    if (showCustom) {
      items.push({ icon: Star, label: '自定義', href: '/douban?type=custom' });
    }
    return items;
  }, [showLive, showCustom]);

  return (
    <SidebarContext.Provider value={contextValue}>
      <div className='hidden md:flex'>
        <aside className='fixed top-0 left-0 h-screen z-50 flex w-24 flex-col items-center py-8 glass-panel border-r border-zinc-200/70 dark:border-accent/20 bg-white/90 dark:bg-anime-dark/80 shadow-[0_0_15px_rgba(0,229,255,0.05)]'>
          <div className='flex items-center justify-center gap-3 mb-10 px-4 w-full'>
            <MonitorPlay className='w-7 h-7 text-accent drop-shadow-[0_0_8px_rgba(0,180,216,0.6)]' />
          </div>

          <nav className='flex-1 w-full px-3 space-y-2 flex flex-col items-stretch'>
            <NavLink
              href='/'
              icon={Home}
              label='首頁'
              isActive={active === '/'}
              onClick={() => setActive('/')}
            />
            <NavLink
              href='/search'
              icon={Search}
              label='搜尋'
              isActive={active === '/search'}
              onClick={(e) => {
                e.preventDefault();
                handleSearchClick();
                setActive('/search');
              }}
            />
            <NavLink
              href='/?tab=favorites'
              icon={BookMarked}
              label='收藏夾'
              isActive={active === '/?tab=favorites'}
              onClick={() => setActive('/?tab=favorites')}
            />
            <NavLink
              href='/history'
              icon={Clock}
              label='觀看記錄'
              isActive={active === '/history'}
              onClick={() => setActive('/history')}
            />

            <div className='border-t border-accent/10 my-4' />

            {menuItems.map((item) => {
              const typeMatch = item.href.match(/type=([^&]+)/)?.[1];
              const decodedActive = decodeURIComponent(active);
              const decodedItemHref = decodeURIComponent(item.href);
              const isActive =
                decodedActive === decodedItemHref ||
                (decodedActive.startsWith('/douban') &&
                  decodedActive.includes(`type=${typeMatch}`));
              return (
                <NavLink
                  key={item.label}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  isActive={isActive}
                  onClick={() => setActive(item.href)}
                />
              );
            })}
          </nav>

          <span className='text-[10px] text-zinc-500 dark:text-zinc-600 mt-auto'>
            {CURRENT_VERSION}
          </span>
        </aside>
        <div className='w-24' />
      </div>
    </SidebarContext.Provider>
  );
};

export default Sidebar;
