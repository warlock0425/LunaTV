/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-console */
'use client';

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';

const SiteContext = createContext<{ siteName: string; announcement?: string }>({
  // 預設值
  siteName: 'BerserkerTV',
  announcement:
    '本網站僅提供影視資訊搜尋服務，所有內容均來自第三方網站。本站不儲存任何影片資源，不對任何內容的準確性、合法性、完整性負責。',
});

export const useSite = () => useContext(SiteContext);

export function SiteProvider({
  children,
  siteName: initialSiteName,
  announcement: initialAnnouncement,
}: {
  children: ReactNode;
  siteName: string;
  announcement?: string;
}) {
  const [siteName, setSiteName] = useState(initialSiteName);
  const [announcement, setAnnouncement] = useState(initialAnnouncement);

  useEffect(() => {
    setSiteName(initialSiteName);
    setAnnouncement(initialAnnouncement);

    // 如果使用的是 localstorage 儲存類型，則從客戶端讀取配置覆蓋
    const runtimeConfig = window.RUNTIME_CONFIG;
    if (runtimeConfig && runtimeConfig.STORAGE_TYPE === 'localstorage') {
      const localConfig = localStorage.getItem('lunatv_config');
      if (localConfig) {
        try {
          const parsed = JSON.parse(localConfig);
          if (parsed.SiteConfig?.SiteName) {
            setSiteName(parsed.SiteConfig.SiteName);
          }
          if (parsed.SiteConfig?.Announcement) {
            setAnnouncement(parsed.SiteConfig.Announcement);
          }
        } catch (e) {
          console.error('Failed to parse local config', e);
        }
      }
    }
  }, [initialSiteName, initialAnnouncement]);

  return (
    <SiteContext.Provider value={{ siteName, announcement }}>
      {children}
    </SiteContext.Provider>
  );
}
