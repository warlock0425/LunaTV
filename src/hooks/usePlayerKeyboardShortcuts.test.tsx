import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import '@testing-library/jest-dom';

import { SearchResult } from '@/lib/types';

import { usePlayerKeyboardShortcuts } from './usePlayerKeyboardShortcuts';

function createPlayer() {
  return {
    currentTime: 100,
    duration: 1000,
    volume: 0.5,
    playbackRate: 1,
    muted: false,
    fullscreen: false,
    notice: { show: '' },
    toggle: jest.fn(),
  };
}

function setup(player: ReturnType<typeof createPlayer> | null) {
  const onPreviousEpisode = jest.fn();
  const onNextEpisode = jest.fn();
  const onToggleShortcutsHelp = jest.fn();

  const artPlayerRef = createRef<unknown>() as { current: unknown };
  artPlayerRef.current = player;
  const detailRef = { current: { episodes: ['a', 'b', 'c'] } as SearchResult };
  const currentEpisodeIndexRef = { current: 1 };

  renderHook(() =>
    usePlayerKeyboardShortcuts({
      artPlayerRef: artPlayerRef as React.RefObject<unknown>,
      detailRef: detailRef as React.RefObject<SearchResult | null>,
      currentEpisodeIndexRef: currentEpisodeIndexRef as React.RefObject<number>,
      onPreviousEpisode,
      onNextEpisode,
      onToggleShortcutsHelp,
    })
  );

  return { onPreviousEpisode, onNextEpisode, onToggleShortcutsHelp };
}

function press(key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
}

/**
 * 這些快捷鍵掛在 document 上，若不排除修飾鍵組合，會把瀏覽器自己的快捷鍵
 * 整個吃掉：在播放頁按 Ctrl+F 會變成切換全螢幕而不是開啟「尋找」，
 * Ctrl+H 會開快捷鍵面板而不是歷史紀錄，而且都被 preventDefault。
 */
describe('usePlayerKeyboardShortcuts 修飾鍵處理', () => {
  it('Ctrl / Cmd 組合鍵不觸發播放器動作也不阻止預設行為', () => {
    const player = createPlayer();
    const { onToggleShortcutsHelp } = setup(player);

    const ctrlF = press('f', { ctrlKey: true });
    expect(player.fullscreen).toBe(false);
    expect(ctrlF.defaultPrevented).toBe(false);

    const metaF = press('f', { metaKey: true });
    expect(player.fullscreen).toBe(false);
    expect(metaF.defaultPrevented).toBe(false);

    const ctrlH = press('h', { ctrlKey: true });
    expect(onToggleShortcutsHelp).not.toHaveBeenCalled();
    expect(ctrlH.defaultPrevented).toBe(false);

    const ctrlM = press('m', { ctrlKey: true });
    expect(player.muted).toBe(false);
    expect(ctrlM.defaultPrevented).toBe(false);

    const ctrlSpace = press(' ', { ctrlKey: true });
    expect(player.toggle).not.toHaveBeenCalled();
    expect(ctrlSpace.defaultPrevented).toBe(false);
  });

  it('無修飾鍵時照常運作', () => {
    const player = createPlayer();
    const { onToggleShortcutsHelp } = setup(player);

    expect(press('f').defaultPrevented).toBe(true);
    expect(player.fullscreen).toBe(true);

    press('m');
    expect(player.muted).toBe(true);

    press(' ');
    expect(player.toggle).toHaveBeenCalledTimes(1);

    press('h');
    expect(onToggleShortcutsHelp).toHaveBeenCalledTimes(1);
  });

  it('Alt 組合鍵仍保留給換集（本頁刻意使用）', () => {
    const player = createPlayer();
    const { onPreviousEpisode, onNextEpisode } = setup(player);

    press('ArrowLeft', { altKey: true });
    expect(onPreviousEpisode).toHaveBeenCalledTimes(1);

    press('ArrowRight', { altKey: true });
    expect(onNextEpisode).toHaveBeenCalledTimes(1);
  });

  it('焦點在輸入元素時完全不介入', () => {
    const player = createPlayer();
    setup(player);

    const input = document.createElement('input');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    document.body.append(input, editable);

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', bubbles: true })
    );
    expect(player.fullscreen).toBe(false);

    editable.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'f', bubbles: true })
    );
    expect(player.fullscreen).toBe(false);

    input.remove();
    editable.remove();
  });
});
