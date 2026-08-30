import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_TC } from 'next/font/google';

import './globals.css';

import { getConfig } from '@/lib/config';
import { serializeForInlineScript } from '@/lib/safe-json';
import { DEFAULT_SITE_NAME } from '@/lib/site-defaults';
import { getServerStorageType } from '@/lib/storage-runtime';

import { ChunkReloadGuard } from '../components/ChunkReloadGuard';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { GlobalErrorIndicator } from '../components/GlobalErrorIndicator';
import { PwaRegister } from '../components/PwaRegister';
import { SiteProvider } from '../components/SiteProvider';
import { ThemeColorSync } from '../components/ThemeColorSync';
import { ThemeProvider } from '../components/ThemeProvider';
import { ToastProvider } from '../components/ToastProvider';

// iOS PWA 啟動畫（apple-touch-startup-image 需精確匹配裝置尺寸）
const APPLE_SPLASH_SCREENS = [
  { w: 375, h: 667, dpr: 2, src: '/splash/splash-750x1334.png' },
  { w: 414, h: 896, dpr: 2, src: '/splash/splash-828x1792.png' },
  { w: 375, h: 812, dpr: 3, src: '/splash/splash-1125x2436.png' },
  { w: 390, h: 844, dpr: 3, src: '/splash/splash-1170x2532.png' },
  { w: 393, h: 852, dpr: 3, src: '/splash/splash-1179x2556.png' },
  { w: 414, h: 896, dpr: 3, src: '/splash/splash-1242x2688.png' },
  { w: 428, h: 926, dpr: 3, src: '/splash/splash-1284x2778.png' },
  { w: 430, h: 932, dpr: 3, src: '/splash/splash-1290x2796.png' },
  { w: 768, h: 1024, dpr: 2, src: '/splash/splash-1536x2048.png' },
  { w: 834, h: 1194, dpr: 2, src: '/splash/splash-1668x2388.png' },
  { w: 1024, h: 1366, dpr: 2, src: '/splash/splash-2048x2732.png' },
];

const inter = Inter({ subsets: ['latin'] });
const notoSansTC = Noto_Sans_TC({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-noto-sans-tc',
});
export const dynamic = 'force-dynamic';

// 動態生成 metadata，支援設定更新後的標題變化
export async function generateMetadata(): Promise<Metadata> {
  const storageType = getServerStorageType();
  const config = await getConfig();
  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || DEFAULT_SITE_NAME;
  if (storageType !== 'localstorage') {
    siteName = config.SiteConfig.SiteName;
  }

  return {
    title: siteName,
    description: '影視聚合',
    manifest: '/manifest.json',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'black-translucent',
      title: siteName,
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // 本站固定深色（ThemeProvider forcedTheme='dark'），因此不隨系統偏好切換，
  // 直接對齊 globals.css 的 html.dark body 背景色，避免淺色系統下瀏覽器
  // 狀態列出現白底而與頁面不連續。
  themeColor: '#050505',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const storageType = getServerStorageType();

  let siteName = process.env.NEXT_PUBLIC_SITE_NAME || DEFAULT_SITE_NAME;
  let announcement =
    process.env.ANNOUNCEMENT ||
    '本網站僅提供影視資訊搜尋服務，所有內容均來自第三方網站。本站不儲存任何影片資源，不對任何內容的準確性、合法性、完整性負責。';

  let doubanProxyType =
    process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'cmliussss-cdn-tencent';
  let doubanProxy = process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';
  let doubanImageProxyType =
    process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE || 'cmliussss-cdn-tencent';
  let doubanImageProxy = process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '';
  let disableYellowFilter =
    process.env.NEXT_PUBLIC_DISABLE_YELLOW_FILTER === 'true';
  let fluidSearch = process.env.NEXT_PUBLIC_FLUID_SEARCH !== 'false';
  let enableWebLive = false;
  let customCategories = [] as {
    name: string;
    type: 'movie' | 'tv';
    query: string;
  }[];
  if (storageType !== 'localstorage') {
    const config = await getConfig();
    siteName = config.SiteConfig.SiteName;
    announcement = config.SiteConfig.Announcement;

    doubanProxyType = config.SiteConfig.DoubanProxyType;
    doubanProxy = config.SiteConfig.DoubanProxy;
    doubanImageProxyType = config.SiteConfig.DoubanImageProxyType;
    doubanImageProxy = config.SiteConfig.DoubanImageProxy;
    disableYellowFilter = config.SiteConfig.DisableYellowFilter;
    customCategories = config.CustomCategories.filter(
      (category) => !category.disabled
    ).map((category) => ({
      name: category.name || '',
      type: category.type,
      query: category.query,
    }));
    fluidSearch = config.SiteConfig.FluidSearch;
    enableWebLive = config.SiteConfig.EnableWebLive ?? false;
  }

  // 將運行時設定注入到全局 window 對象，供客戶端在運行時讀取
  const runtimeConfig = {
    STORAGE_TYPE: storageType,
    DOUBAN_PROXY_TYPE: doubanProxyType,
    DOUBAN_PROXY: doubanProxy,
    DOUBAN_IMAGE_PROXY_TYPE: doubanImageProxyType,
    DOUBAN_IMAGE_PROXY: doubanImageProxy,
    DISABLE_YELLOW_FILTER: disableYellowFilter,
    CUSTOM_CATEGORIES: customCategories,
    FLUID_SEARCH: fluidSearch,
    ENABLE_WEB_LIVE: enableWebLive,
  };

  return (
    <html
      lang='zh-Hant'
      translate='no'
      className='notranslate'
      suppressHydrationWarning
    >
      <head>
        <link rel='apple-touch-icon' href='/icons/icon-192x192.png' />
        {APPLE_SPLASH_SCREENS.map((splash) => (
          <link
            key={splash.src}
            rel='apple-touch-startup-image'
            media={`(device-width: ${splash.w}px) and (device-height: ${splash.h}px) and (-webkit-device-pixel-ratio: ${splash.dpr}) and (orientation: portrait)`}
            href={splash.src}
          />
        ))}
        {/* 將設定序列化後直接寫入腳本，瀏覽器端可透過 window.RUNTIME_CONFIG 取得 */}
        {}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.RUNTIME_CONFIG = ${serializeForInlineScript(
              runtimeConfig
            )};`,
          }}
        />
      </head>
      <body
        translate='no'
        className={`${inter.className} ${notoSansTC.variable} notranslate font-primary min-h-screen bg-deep text-zinc-200`}
      >
        <ThemeProvider disableTransitionOnChange>
          <ToastProvider>
            <SiteProvider siteName={siteName} announcement={announcement}>
              <ErrorBoundary>{children}</ErrorBoundary>
              <GlobalErrorIndicator />
              <ChunkReloadGuard />
              <PwaRegister />
              <ThemeColorSync />
            </SiteProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
