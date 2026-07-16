import { BackButton } from './BackButton';
import { ErrorBoundary } from './ErrorBoundary';
import MobileBottomNav from './MobileBottomNav';
import MobileHeader from './MobileHeader';
import Sidebar from './Sidebar';
import { UserMenu } from './UserMenu';

interface PageLayoutProps {
  children: React.ReactNode;
  activePath?: string;
}

const PageLayout = ({ children, activePath = '/' }: PageLayoutProps) => {
  return (
    <div className='w-full min-h-screen bg-transparent text-zinc-900 dark:text-zinc-100'>
      {/* 移動端頭部 */}
      <MobileHeader showBackButton={['/play', '/live'].includes(activePath)} />

      {/* 主要佈局容器 */}
      <div className='flex md:grid md:grid-cols-[auto_1fr] w-full min-h-screen md:min-h-auto'>
        {/* 側邊欄 - 桌面端顯示，移動端隱藏 */}
        <div className='hidden md:block'>
          <Sidebar activePath={activePath} />
        </div>

        {/* 主內容區域 */}
        <div className='relative min-w-0 flex-1 transition-all duration-300'>
          {/* 桌面端左上角返回按鈕 */}
          {['/play', '/live'].includes(activePath) && (
            <div className='absolute top-3 left-1 z-20 hidden md:flex'>
              <BackButton />
            </div>
          )}

          {/* 桌面端頂部按鈕 */}
          <div className='absolute top-2 right-4 z-20 hidden md:flex items-center gap-2'>
            <UserMenu />
          </div>

          {/* 主內容 */}
          <main className='flex-1 md:min-h-0 mb-14 md:mb-0 md:mt-0 mt-12 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0'>
            <ErrorBoundary>{children}</ErrorBoundary>
          </main>
        </div>
      </div>

      {/* 移動端底部導航 */}
      <div className='md:hidden'>
        <MobileBottomNav activePath={activePath} />
      </div>
    </div>
  );
};

export default PageLayout;
