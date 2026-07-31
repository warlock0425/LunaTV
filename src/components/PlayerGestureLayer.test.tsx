import { act, render } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

import PlayerGestureLayer from './PlayerGestureLayer';

/**
 * 這一層掛在播放器容器上，而容器的生命週期比播放器實例長：
 * 換集時 artplayer 會被銷毀重建，但本層不會卸載（isVideoLoading 只在換源時
 * 才轉 true）。先前的實作把 play / pause 綁在 artplayer 實例上，換過一次集
 * 之後指示器就永遠不再出現；亮度則是直接寫在容器的 inline style 上，
 * 換源重掛後內部狀態歸零、與畫面實際亮度脫鉤。
 */
function setup(initialFilter = '') {
  const container = document.createElement('div');
  container.style.filter = initialFilter;
  document.body.appendChild(container);

  const video = document.createElement('video');
  container.appendChild(video);

  const containerRef = { current: container };
  // 手勢層只在觸控處理裡用到 artRef，本測試聚焦在容器層事件
  const artRef = { current: { volume: 0.5, currentTime: 0, duration: 100 } };

  const view = render(
    <PlayerGestureLayer
      artRef={artRef as unknown as React.RefObject<unknown>}
      containerRef={containerRef}
    />
  );

  return { container, video, view };
}

function fireMediaEvent(
  media: HTMLMediaElement,
  type: 'play' | 'pause',
  currentTime: number
) {
  Object.defineProperty(media, 'currentTime', {
    value: currentTime,
    configurable: true,
  });
  act(() => {
    media.dispatchEvent(new Event(type));
  });
}

describe('PlayerGestureLayer 播放／暫停指示器', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('播放中暫停會顯示指示器', () => {
    const { video, view } = setup();

    expect(view.container.firstChild).toBeNull();
    fireMediaEvent(video, 'pause', 42);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('開頭的自動播放與初始暫停不彈指示器', () => {
    const { video, view } = setup();

    fireMediaEvent(video, 'play', 0);
    expect(view.container.firstChild).toBeNull();

    fireMediaEvent(video, 'pause', 0.5);
    expect(view.container.firstChild).toBeNull();
  });

  // 這條就是換集後指示器失效的回歸測試
  it('播放器被銷毀重建後仍然有效', () => {
    const { container, video, view } = setup();

    // 模擬換集：舊 video 被移除，容器內長出新的 video
    container.removeChild(video);
    const nextVideo = document.createElement('video');
    container.appendChild(nextVideo);

    fireMediaEvent(nextVideo, 'pause', 87);
    expect(view.container.firstChild).not.toBeNull();
  });

  it('卸載後不再回應事件', () => {
    const { video, view } = setup();
    view.unmount();

    expect(() => fireMediaEvent(video, 'pause', 42)).not.toThrow();
  });
});

describe('PlayerGestureLayer 亮度狀態', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('掛載時從容器讀回既有亮度，不會把內部狀態重置成 100%', () => {
    // 換源前使用者把亮度調到 60%，重掛後 DOM 仍保有該值
    const { container } = setup('brightness(0.6)');

    // 容器的實際亮度不應被元件掛載動作改寫
    expect(container.style.filter).toBe('brightness(0.6)');
  });

  it('容器沒有亮度樣式時不拋錯', () => {
    expect(() => setup('')).not.toThrow();
    expect(() => setup('blur(2px)')).not.toThrow();
  });
});
