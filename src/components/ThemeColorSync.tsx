'use client';

import { useEffect } from 'react';

const LIGHT_COLOR = '#ffffff';
const DARK_COLOR = '#000000';

/**
 * 依照 next-themes 切換出的實際主題（html.dark class）同步
 * meta[name="theme-color"]，讓瀏覽器工具列／PWA 標題列顏色
 * 跟隨站內主題，而非只看作業系統偏好。
 */
export function ThemeColorSync() {
  useEffect(() => {
    const apply = () => {
      const isDark = document.documentElement.classList.contains('dark');
      const color = isDark ? DARK_COLOR : LIGHT_COLOR;
      document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((meta) => meta.setAttribute('content', color));
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return null;
}
