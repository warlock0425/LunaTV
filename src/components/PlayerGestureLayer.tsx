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
    type: 'seek' | 'volume' | 'brightness' | 'play' | 'pause' | null;
    value: string;
    position?: 'left' | 'center' | 'right';
  }>({ type: null, value: '' });

  const indicatorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showIndicator = (
    type: 'seek' | 'volume' | 'brightness' | 'play' | 'pause',
    value: string,
    position: 'left' | 'center' | 'right' = 'center'
  ) => {
    setIndicator({ type, value, position });
    if (indicatorTimeoutRef.current) {
      clearTimeout(indicatorTimeoutRef.current);
    }
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

      if (artRef.current) {
        startVolume.current = artRef.current.volume || 0;
        startCurrentTime.current = artRef.current.currentTime || 0;
      }
      startBrightness.current = brightnessRef.current;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartPos.current || !artRef.current) return;
      if (e.touches.length > 1) return;

      const touch = e.touches[0];
      const dx = touch.clientX - touchStartPos.current.x;
      const dy = touch.clientY - touchStartPos.current.y;

      if (!touchDirection.current) {
        if (Math.abs(dx) > 15 || Math.abs(dy) > 15) {
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

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [artRef, containerRef]);

  const isFirstPlay = useRef(true);
  const isFirstPause = useRef(true);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return;

    const onPlay = () => {
      if (isFirstPlay.current) {
        isFirstPlay.current = false;
        return;
      }
      showIndicator('play', '', 'center');
    };

    const onPause = () => {
      if (art.currentTime < 1 && isFirstPause.current) {
        isFirstPause.current = false;
        return;
      }
      showIndicator('pause', '', 'center');
    };

    art.on('play', onPlay);
    art.on('pause', onPause);

    return () => {
      art.off('play', onPlay);
      art.off('pause', onPause);
    };
  }, [artRef]);

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
