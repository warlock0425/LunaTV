import { useCallback, useEffect, useRef } from 'react';

interface UseLongPressOptions {
  onLongPress: () => void;
  onClick?: () => void;
  longPressDelay?: number;
  moveThreshold?: number;
}

interface TouchPosition {
  x: number;
  y: number;
}

export const useLongPress = ({
  onLongPress,
  onClick,
  longPressDelay = 500,
  moveThreshold = 10,
}: UseLongPressOptions) => {
  const isLongPress = useRef(false);
  const pressTimer = useRef<NodeJS.Timeout | null>(null);
  const startPosition = useRef<TouchPosition | null>(null);
  const isActive = useRef(false); // 防止重複觸發
  const wasButton = useRef(false); // 記錄觸摸開始時是否是按鈕

  const clearTimer = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const handleStart = useCallback(
    (clientX: number, clientY: number, isButton = false) => {
      // 如果已經有活躍的手勢，忽略新的開始
      if (isActive.current) {
        return;
      }

      isActive.current = true;
      isLongPress.current = false;
      startPosition.current = { x: clientX, y: clientY };

      // 記錄觸摸開始時是否是按鈕
      wasButton.current = isButton;

      pressTimer.current = setTimeout(() => {
        // 再次檢查是否仍然活躍
        if (!isActive.current) return;

        isLongPress.current = true;

        if (navigator.vibrate) {
          navigator.vibrate(50);
        }

        // 觸發長按事件
        onLongPress();
      }, longPressDelay);
    },
    [onLongPress, longPressDelay]
  );

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!startPosition.current || !isActive.current) return;

      const distance = Math.sqrt(
        Math.pow(clientX - startPosition.current.x, 2) +
          Math.pow(clientY - startPosition.current.y, 2)
      );

      // 如果移動距離超過閾值，取消長按
      if (distance > moveThreshold) {
        clearTimer();
        isActive.current = false;
      }
    },
    [clearTimer, moveThreshold]
  );

  const handleEnd = useCallback(() => {
    clearTimer();

    // 根據情況決定是否觸發點擊事件：
    // 1. 如果是長按，不觸發點擊
    // 2. 如果不是長按且觸摸開始時是按鈕，不觸發點擊
    // 3. 否則觸發點擊
    const shouldClick =
      !isLongPress.current && !wasButton.current && onClick && isActive.current;

    if (shouldClick) {
      onClick();
    }

    // 重置所有狀態
    isLongPress.current = false;
    startPosition.current = null;
    isActive.current = false;
    wasButton.current = false;
  }, [clearTimer, onClick]);

  // 觸摸事件處理器
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // 檢查是否觸摸的是按鈕或其他交互元素
      const target = e.target as HTMLElement;
      const buttonElement = target.closest('[data-button]');

      // 更精確的按鈕檢測：只有當觸摸目標直接是按鈕元素或其直接子元素時才認為是按鈕
      const isDirectButton = target.hasAttribute('data-button');
      const isButton = !!buttonElement && isDirectButton;

      // 阻止默认的长按行为，但不阻止触摸开始事件
      const touch = e.touches[0];
      handleStart(touch.clientX, touch.clientY, !!isButton);
    },
    [handleStart]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      handleMove(touch.clientX, touch.clientY);
    },
    [handleMove]
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      // 始终阻止默认行为，避免任何系统长按菜单
      e.preventDefault();
      e.stopPropagation();
      handleEnd();
    },
    [handleEnd]
  );

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
};
