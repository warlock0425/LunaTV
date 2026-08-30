/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import React, { useEffect, useRef, useState } from 'react';

import GestureIndicator from './GestureIndicator';

interface PlayerGestureLayerProps {
  artRef: React.RefObject<any>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export default function PlayerGestureLayer({
  artRef,
  containerRef,
}: PlayerGestureLayerProps) {
  const [indicator, setIndicator] = useState<{
    type: 'seek' | 'volume' | 'brightness' | 'play' | 'pause' | 'speed' | null;
    value: string;
    position?: 'left' | 'center' | 'right';
  }>({ type: null, value: '' });

  const indicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressingRef = useRef(false);
  const startPlaybackRateRef = useRef(1);

  const showIndicator = (
    type: 'seek' | 'volume' | 'brightness' | 'play' | 'pause' | 'speed',
    value: string,
    position: 'left' | 'center' | 'right' = 'center',
    persist = false
  ) => {
    setIndicator({ type, value, position });
    if (indicatorTimeoutRef.current) {
      clearTimeout(indicatorTimeoutRef.current);
      indicatorTimeoutRef.current = null;
    }
    if (persist) return;
    indicatorTimeoutRef.current = setTimeout(() => {
      setIndicator({ type: null, value: '' });
    }, 800);
  };

  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const touchDirection = useRef<'horizontal' | 'vertical' | null>(null);
  const accumulatedDelta = useRef<number>(0);
  const isGestureActive = useRef<boolean>(false);

  // For double tap
  const lastTapTime = useRef<number>(0);
  const lastTapPos = useRef<{ x: number; y: number } | null>(null);

  // Initial values for relative adjustments
  const startVolume = useRef<number>(0);
  const brightnessRef = useRef<number>(1.0); // store current brightness
  const startBrightness = useRef<number>(1.0);
  const startCurrentTime = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 亮度是直接寫在容器的 inline style 上，會比本元件活得久——換源時本層會
    // 卸載重掛，容器卻是同一個。掛載時從 DOM 讀回實際亮度，否則內部狀態會
    // 重置成 1.0，指示器顯示的百分比與畫面實際亮度對不上，下一次調整還會跳。
    const appliedBrightness = container.style.filter.match(
      /brightness\(([\d.]+)\)/
    );
    if (appliedBrightness) {
      const parsed = Number.parseFloat(appliedBrightness[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        brightnessRef.current = parsed;
      }
    }

    const clearLongPressTimer = () => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    const restorePlaybackRate = () => {
      if (!isLongPressingRef.current) return;
      isLongPressingRef.current = false;
      if (artRef.current) {
        artRef.current.holdSpeed = false;
        artRef.current.playbackRate = startPlaybackRateRef.current;
      }
      setIndicator({ type: null, value: '' });
    };

    const handleTouchStart = (e: TouchEvent) => {
      // 忽略控制列的觸控
      if (
        (e.target as Element).closest?.(
          '.art-bottom, .art-controls, .art-setting'
        )
      )
        return;
      if (e.touches.length > 1) return;

      const touch = e.touches[0];
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      touchDirection.current = null;
      accumulatedDelta.current = 0;
      isGestureActive.current = false;
      isLongPressingRef.current = false;
      clearLongPressTimer();

      if (artRef.current) {
        startVolume.current = artRef.current.volume || 0;
        startCurrentTime.current = artRef.current.currentTime || 0;
        startPlaybackRateRef.current = artRef.current.playbackRate || 1;
      }
      startBrightness.current = brightnessRef.current;

      longPressTimerRef.current = setTimeout(() => {
        if (touchDirection.current || !artRef.current) return;
        isLongPressingRef.current = true;
        isGestureActive.current = true;
        artRef.current.holdSpeed = true;
        artRef.current.playbackRate = 2;
        showIndicator('speed', '2x', 'center', true);
      }, 400);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartPos.current || !artRef.current) return;
      if (e.touches.length > 1) return;
      if (isLongPressingRef.current) {
        if (e.cancelable) e.preventDefault();
        return;
      }

      const touch = e.touches[0];
      const dx = touch.clientX - touchStartPos.current.x;
      const dy = touch.clientY - touchStartPos.current.y;

      if (!touchDirection.current) {
        if (Math.abs(dx) > 15 || Math.abs(dy) > 15) {
          clearLongPressTimer();
          touchDirection.current =
            Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
          isGestureActive.current = true;
        } else {
          return;
        }
      }

      // 防止手勢觸發頁面滾動
      if (e.cancelable) {
        e.preventDefault();
      }

      if (touchDirection.current === 'horizontal') {
        const seekDelta = Math.round(dx * 0.5);
        const cappedDelta = Math.max(-120, Math.min(120, seekDelta));
        accumulatedDelta.current = cappedDelta;

        const sign = cappedDelta >= 0 ? '+' : '';
        showIndicator('seek', `${sign}${cappedDelta}s`, 'center');
      } else if (touchDirection.current === 'vertical') {
        const containerWidth = container.clientWidth || window.innerWidth;
        const isRightSide = touchStartPos.current.x > containerWidth / 2;
        const percentDelta = -(dy / 200);

        if (isRightSide) {
          const newVol = Math.max(
            0,
            Math.min(1, startVolume.current + percentDelta)
          );
          artRef.current.volume = newVol;
          showIndicator('volume', `${Math.round(newVol * 100)}%`, 'right');
        } else {
          const newBright = Math.max(
            0.2,
            Math.min(1.5, startBrightness.current + percentDelta)
          );
          brightnessRef.current = newBright;
          container.style.filter = `brightness(${newBright})`;
          showIndicator(
            'brightness',
            `${Math.round(newBright * 100)}%`,
            'left'
          );
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStartPos.current) return;
      clearLongPressTimer();
      if (isLongPressingRef.current) {
        restorePlaybackRate();
        touchStartPos.current = null;
        touchDirection.current = null;
        accumulatedDelta.current = 0;
        isGestureActive.current = false;
        return;
      }
      const changedTouch = e.changedTouches[0];
      const now = Date.now();

      if (isGestureActive.current) {
        if (touchDirection.current === 'horizontal' && artRef.current) {
          let newTime = startCurrentTime.current + accumulatedDelta.current;
          newTime = Math.max(
            0,
            Math.min(newTime, artRef.current.duration || Infinity)
          );
          artRef.current.currentTime = newTime;
          const sign = accumulatedDelta.current >= 0 ? '+' : '';
          artRef.current.notice.show = `進度 ${sign}${accumulatedDelta.current}s`;
        }
      } else {
        // Tap detection
        const tapX = changedTouch.clientX;
        const tapY = changedTouch.clientY;

        if (
          lastTapPos.current &&
          now - lastTapTime.current < 300 &&
          Math.abs(tapX - lastTapPos.current.x) < 30 &&
          Math.abs(tapY - lastTapPos.current.y) < 30
        ) {
          // Double tap
          const containerWidth = container.clientWidth || window.innerWidth;
          const isRightSide = tapX > containerWidth / 2;

          if (artRef.current) {
            if (isRightSide) {
              artRef.current.currentTime = Math.min(
                (artRef.current.currentTime || 0) + 10,
                artRef.current.duration || Infinity
              );
              showIndicator('seek', '+10s', 'right');
              artRef.current.notice.show = '快進 +10s';
            } else {
              artRef.current.currentTime = Math.max(
                (artRef.current.currentTime || 0) - 10,
                0
              );
              showIndicator('seek', '-10s', 'left');
              artRef.current.notice.show = '快退 -10s';
            }
          }
          lastTapTime.current = 0;
        } else {
          lastTapTime.current = now;
          lastTapPos.current = { x: tapX, y: tapY };
        }
      }

      touchStartPos.current = null;
      touchDirection.current = null;
      accumulatedDelta.current = 0;
      isGestureActive.current = false;
    };

    container.addEventListener('touchstart', handleTouchStart, {
      passive: false,
    });
    container.addEventListener('touchmove', handleTouchMove, {
      passive: false,
    });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });
    container.addEventListener('touchcancel', handleTouchEnd, {
      passive: false,
    });

    return () => {
      clearLongPressTimer();
      restorePlaybackRate();
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [artRef, containerRef]);

  /**
   * 播放／暫停指示器。
   *
   * 刻意監聽「容器的捕獲階段」而不是 artplayer 實例：換集時播放器會被銷毀重建，
   * 但本層不會卸載（isVideoLoading 只在換源時才轉 true），綁在舊實例上的
   * art.on('play') 會直接失效——換過一次集之後指示器就再也不會出現。
   * play / pause 是不冒泡的媒體事件，但捕獲階段仍會經過祖先節點，因此掛在
   * 容器上可以涵蓋任何時候被重建的 video 元素。
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 開頭自動播放與初始暫停不該彈指示器。以 currentTime 判斷而非一次性旗標，
    // 這樣每個重建出來的播放器都適用。
    const isAtStart = (event: Event) => {
      const media = event.target as HTMLMediaElement | null;
      return typeof media?.currentTime === 'number' && media.currentTime < 1;
    };

    const onPlay = (event: Event) => {
      if (isAtStart(event)) return;
      showIndicator('play', '', 'center');
    };

    const onPause = (event: Event) => {
      if (isAtStart(event)) return;
      showIndicator('pause', '', 'center');
    };

    container.addEventListener('play', onPlay, true);
    container.addEventListener('pause', onPause, true);

    return () => {
      container.removeEventListener('play', onPlay, true);
      container.removeEventListener('pause', onPause, true);
    };
  }, [containerRef]);

  useEffect(() => {
    return () => {
      if (indicatorTimeoutRef.current)
        clearTimeout(indicatorTimeoutRef.current);
    };
  }, []);

  return (
    <GestureIndicator
      type={indicator.type}
      value={indicator.value}
      position={indicator.position}
    />
  );
}
