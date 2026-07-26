'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import {
  directionFromKey,
  NavCandidate,
  pickInitialCandidate,
  pickNextCandidate,
  shouldYieldToElement,
} from '@/lib/spatial-navigation';

/**
 * 讓電視遙控器（D-pad）能操作整個站台。
 *
 * 瀏覽器原生只用 Tab 依 DOM 順序移動焦點，按方向鍵不會有任何反應，
 * 這是本專案在電視上無法操作的唯一障礙——版面、聚焦外框、按鈕語意
 * 都已經就緒（實測 1920x1080 下 12/12 可聚焦元素皆可達且有外框）。
 *
 * 刻意「只在電視上啟用」：桌機與手機的行為完全不變，方向鍵仍然捲動頁面。
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** 是否為電視類裝置（或使用者手動開啟） */
function isRemoteControlledDevice(): boolean {
  if (typeof window === 'undefined') return false;

  // 疑難排解／手動啟用：?tv=1 或 localStorage
  try {
    if (new URLSearchParams(window.location.search).get('tv') === '1') {
      window.localStorage.setItem('tvRemoteNavigation', 'true');
    }
    const stored = window.localStorage.getItem('tvRemoteNavigation');
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // 無痕模式等情境讀不到 localStorage，往下走自動偵測即可
  }

  const ua = navigator.userAgent;
  if (
    /\b(?:GoogleTV|Android\s?TV|SMART-TV|SmartTV|HbbTV|NetCast|Web0S|WebOS|Tizen|BRAVIA|AFT[A-Z]{1,3}|Roku)\b/i.test(
      ua
    )
  ) {
    return true;
  }

  // 電視沒有指標裝置；Android TV 版 Chrome 會回報 pointer: none
  try {
    if (window.matchMedia('(pointer: none)').matches) return true;
  } catch {
    // 舊瀏覽器不支援時忽略
  }

  return false;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  // opacity:0 的元素在畫面上看不見，不應該成為焦點落點
  if (Number(style.opacity) === 0) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  return true;
}

function collectCandidates(): NavCandidate<HTMLElement>[] {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  );
  const result: NavCandidate<HTMLElement>[] = [];
  for (const el of nodes) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    result.push({
      ref: el,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    });
  }
  return result;
}

function focusElement(el: HTMLElement) {
  el.focus({ preventScroll: true });
  // 電視畫面大，焦點務必捲進可視範圍，否則使用者看不到自己選到哪
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export default function TvRemoteNavigation() {
  const pathname = usePathname();

  /**
   * 進入畫面時自動給予初始焦點。
   *
   * Android TV 指引要求「使用者可以立刻用方向鍵操作」；若進畫面時沒有焦點，
   * 第一次按方向鍵只會變成「取得焦點」而不會移動，體感就是按了沒反應——
   * 而且每次換頁都會再發生一次。
   *
   * 內容多為非同步載入，因此在一段時間內重試，直到抓到可聚焦的元素為止。
   */
  useEffect(() => {
    if (!isRemoteControlledDevice()) return;

    let cancelled = false;
    let attempts = 0;

    const tryFocus = () => {
      if (cancelled) return;
      const active = document.activeElement as HTMLElement | null;
      // 已經有焦點（例如使用者正在輸入密碼）就不要搶走
      if (active && active !== document.body) return;

      // 初始焦點避開文字輸入框：在電視上聚焦搜尋框會叫出螢幕小鍵盤蓋住畫面，
      // 使用者得先按返回才能繼續瀏覽。沒有其他可聚焦元素時才退而求其次。
      const all = collectCandidates();
      const nonInput = all.filter((c) => {
        const tag = c.ref.tagName.toLowerCase();
        if (tag === 'textarea') return false;
        if (tag !== 'input') return true;
        const type = (c.ref.getAttribute('type') || 'text').toLowerCase();
        return ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(
          type
        );
      });

      const initial = pickInitialCandidate(
        nonInput.length > 0 ? nonInput : all,
        window.innerHeight
      );
      if (initial) {
        focusElement(initial.ref);
        return;
      }
      if (attempts++ < 20) window.setTimeout(tryFocus, 250);
    };

    const timer = window.setTimeout(tryFocus, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (!isRemoteControlledDevice()) return;

    document.documentElement.dataset.tvRemote = 'on';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      const direction = directionFromKey(event.key);
      if (!direction) return;

      const active = document.activeElement as HTMLElement | null;

      // 輸入框等元素自己需要方向鍵，讓給它們（但單行輸入在邊界時放行，
      // 否則焦點一旦掉進搜尋框就再也離不開）
      if (active) {
        const input = active as HTMLInputElement;
        let selectionStart: number | null = null;
        let selectionEnd: number | null = null;
        try {
          selectionStart = input.selectionStart ?? null;
          selectionEnd = input.selectionEnd ?? null;
        } catch {
          // 部分 input type 讀取 selection 會拋錯（如 type=number）
        }
        if (
          shouldYieldToElement(direction, {
            tagName: active.tagName,
            type: active.getAttribute('type'),
            isContentEditable: active.isContentEditable,
            selectionStart,
            selectionEnd,
            valueLength: (input.value || '').length,
          })
        ) {
          return;
        }
      }

      const candidates = collectCandidates();
      if (candidates.length === 0) return;

      // 尚未有焦點（例如剛進站）：先給一個明確的落點
      if (!active || active === document.body) {
        const initial = pickInitialCandidate(candidates, window.innerHeight);
        if (initial) {
          event.preventDefault();
          focusElement(initial.ref);
        }
        return;
      }

      const currentRect = active.getBoundingClientRect();
      const next = pickNextCandidate(
        direction,
        {
          left: currentRect.left,
          top: currentRect.top,
          right: currentRect.right,
          bottom: currentRect.bottom,
        },
        candidates.filter((c) => c.ref !== active)
      );

      if (!next) return; // 該方向沒有東西：不攔截，讓瀏覽器捲動

      event.preventDefault();
      focusElement(next.ref);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      delete document.documentElement.dataset.tvRemote;
    };
  }, []);

  return null;
}
