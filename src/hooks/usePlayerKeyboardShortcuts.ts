import { useEffect, useRef } from 'react';

import { SearchResult } from '@/lib/types';

interface PlayerKeyboardShortcutsOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  artPlayerRef: React.RefObject<any>;
  detailRef: React.RefObject<SearchResult | null>;
  currentEpisodeIndexRef: React.RefObject<number>;
  onPreviousEpisode: () => void;
  onNextEpisode: () => void;
  onToggleShortcutsHelp: () => void;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * 播放頁全域鍵盤快捷鍵：
 * 方向鍵（快進退/音量）、Alt+方向鍵（換集）、空白鍵（播放暫停）、
 * F（全螢幕）、[ ]（倍速）、M（靜音）、? / H（快捷鍵幫助）。
 */
export function usePlayerKeyboardShortcuts(
  options: PlayerKeyboardShortcutsOptions
) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      const {
        artPlayerRef,
        detailRef,
        currentEpisodeIndexRef,
        onPreviousEpisode,
        onNextEpisode,
        onToggleShortcutsHelp,
      } = optionsRef.current;

      // 忽略輸入框，以及按鈕／連結上的 Space、方向鍵（讓焦點操作自己生效）
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable ||
        (typeof target?.closest === 'function' &&
          target.closest('button, [role="button"], [role="switch"], a[href]'))
      )
        return;

      // 放行瀏覽器／系統快捷鍵：不加這道防線，Ctrl+F（尋找）會被下方的
      // 全螢幕切換吃掉、Ctrl+H（歷史）會開啟快捷鍵面板，且都被 preventDefault。
      // Alt 是本頁刻意使用的換集組合鍵，因此不在攔截範圍。
      if (e.ctrlKey || e.metaKey) return;

      // Alt + 左箭頭 = 上一集
      if (e.altKey && e.key === 'ArrowLeft') {
        if (detailRef.current && currentEpisodeIndexRef.current > 0) {
          onPreviousEpisode();
          e.preventDefault();
        }
      }

      // Alt + 右箭頭 = 下一集
      if (e.altKey && e.key === 'ArrowRight') {
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && idx < d.episodes.length - 1) {
          onNextEpisode();
          e.preventDefault();
        }
      }

      // 左箭頭 = 快退
      if (!e.altKey && e.key === 'ArrowLeft') {
        if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
          artPlayerRef.current.currentTime -= 10;
          e.preventDefault();
        }
      }

      // 右箭頭 = 快進
      if (!e.altKey && e.key === 'ArrowRight') {
        if (
          artPlayerRef.current &&
          artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
        ) {
          artPlayerRef.current.currentTime += 10;
          e.preventDefault();
        }
      }

      // 上箭頭 = 音量+
      if (e.key === 'ArrowUp') {
        if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
          artPlayerRef.current.volume =
            Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
          artPlayerRef.current.notice.show = `音量: ${Math.round(
            artPlayerRef.current.volume * 100
          )}`;
          e.preventDefault();
        }
      }

      // 下箭頭 = 音量-
      if (e.key === 'ArrowDown') {
        if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
          artPlayerRef.current.volume =
            Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
          artPlayerRef.current.notice.show = `音量: ${Math.round(
            artPlayerRef.current.volume * 100
          )}`;
          e.preventDefault();
        }
      }

      // 空格 = 播放/暫停
      if (e.key === ' ') {
        if (artPlayerRef.current) {
          artPlayerRef.current.toggle();
          e.preventDefault();
        }
      }

      // f 鍵 = 切換全屏
      if (e.key === 'f' || e.key === 'F') {
        if (artPlayerRef.current) {
          artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
          e.preventDefault();
        }
      }

      // [ 或 < = 減速一檔
      if (e.key === '[' || e.key === '<') {
        if (artPlayerRef.current) {
          const currentRate = artPlayerRef.current.playbackRate;
          const idx = PLAYBACK_RATES.findIndex(
            (r) => Math.abs(r - currentRate) < 0.01
          );
          let newRate = 1;
          if (idx > 0) {
            newRate = PLAYBACK_RATES[idx - 1];
          } else if (idx === -1) {
            newRate = 1; // reset if unknown
          }
          artPlayerRef.current.playbackRate = newRate;
          artPlayerRef.current.notice.show = `倍速: ${newRate}x`;
          e.preventDefault();
        }
      }

      // ] 或 > = 加速一檔
      if (e.key === ']' || e.key === '>') {
        if (artPlayerRef.current) {
          const currentRate = artPlayerRef.current.playbackRate;
          const idx = PLAYBACK_RATES.findIndex(
            (r) => Math.abs(r - currentRate) < 0.01
          );
          let newRate = 1.25;
          if (idx >= 0 && idx < PLAYBACK_RATES.length - 1) {
            newRate = PLAYBACK_RATES[idx + 1];
          } else if (idx === -1) {
            newRate = 1.25;
          }
          artPlayerRef.current.playbackRate = newRate;
          artPlayerRef.current.notice.show = `倍速: ${newRate}x`;
          e.preventDefault();
        }
      }

      // M = 靜音
      if (e.key === 'm' || e.key === 'M') {
        if (artPlayerRef.current) {
          artPlayerRef.current.muted = !artPlayerRef.current.muted;
          artPlayerRef.current.notice.show = artPlayerRef.current.muted
            ? '已靜音'
            : '取消靜音';
          e.preventDefault();
        }
      }

      // ? 或 h 鍵 = 顯示快捷鍵幫助
      if (e.key === '?' || e.key === 'h' || e.key === 'H') {
        onToggleShortcutsHelp();
        e.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);
}
