'use client';

import { createContext, ReactNode, useContext } from 'react';

import { DEFAULT_SITE_NAME } from '@/lib/site-defaults';
import { useClientValue } from '@/hooks/useClientMount';

const SiteContext = createContext<{ siteName: string; announcement?: string }>({
  // 預設值
  siteName: DEFAULT_SITE_NAME,
  announcement:
    '本網站僅提供影視資訊搜尋服務，所有內容均來自第三方網站。本站不儲存任何影片資源，不對任何內容的準確性、合法性、完整性負責。',
});

export const useSite = () => useContext(SiteContext);

let cachedLocalOverride:
  { siteName?: string; announcement?: string } | null | undefined;
function readLocalSiteOverride(): {
  siteName?: string;
  announcement?: string;
} | null {
  if (cachedLocalOverride !== undefined) return cachedLocalOverride;
  cachedLocalOverride = null;
  try {
    if (window.RUNTIME_CONFIG?.STORAGE_TYPE === 'localstorage') {
      const localConfig = localStorage.getItem('lunatv_config');
      if (localConfig) {
        const parsed = JSON.parse(localConfig);
        cachedLocalOverride = {
          siteName: parsed.SiteConfig?.SiteName || undefined,
          announcement: parsed.SiteConfig?.Announcement || undefined,
        };
      }
    }
  } catch (e) {
    console.error('Failed to parse local config', e);
  }
  return cachedLocalOverride;
}

export function SiteProvider({
  children,
  siteName: initialSiteName,
  announcement: initialAnnouncement,
}: {
  children: ReactNode;
  siteName: string;
  announcement?: string;
}) {
  // localstorage 模式下用客戶端設定覆蓋（SSR 首輪回傳 null 不覆蓋）
  const localOverride = useClientValue<{
    siteName?: string;
    announcement?: string;
  } | null>(readLocalSiteOverride, null);

  const siteName = localOverride?.siteName ?? initialSiteName;
  const announcement = localOverride?.announcement ?? initialAnnouncement;

  return (
    <SiteContext.Provider value={{ siteName, announcement }}>
      {children}
    </SiteContext.Provider>
  );
}
