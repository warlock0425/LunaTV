import { act, renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';

import { useWakeLock } from './useWakeLock';

type FakeSentinel = { released: boolean; release: jest.Mock };

function installWakeLock() {
  const sentinels: FakeSentinel[] = [];
  const request = jest.fn(async () => {
    const sentinel: FakeSentinel = {
      released: false,
      release: jest.fn(async () => {
        sentinel.released = true;
      }),
    };
    sentinels.push(sentinel);
    return sentinel;
  });

  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
    writable: true,
  });

  return { sentinels, request };
}

/**
 * requestWakeLock 綁在播放器的 'play' 事件上，每次播放都會呼叫。
 * 沒有去重的話每按一次播放就多申請一個 sentinel，而 ref 只留得住最後一個——
 * 先前的永遠釋放不掉，暫停後螢幕仍然不會休眠。
 */
describe('useWakeLock', () => {
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    jest.restoreAllMocks();
  });

  it('重複呼叫 requestWakeLock 只會持有一個 sentinel', async () => {
    const { sentinels, request } = installWakeLock();
    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await result.current.requestWakeLock();
      await result.current.requestWakeLock();
      await result.current.requestWakeLock();
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(sentinels).toHaveLength(1);
  });

  it('併發呼叫不會產生第二個 sentinel', async () => {
    const { request } = installWakeLock();
    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await Promise.all([
        result.current.requestWakeLock(),
        result.current.requestWakeLock(),
      ]);
    });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('釋放後可以重新申請', async () => {
    const { sentinels, request } = installWakeLock();
    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await result.current.requestWakeLock();
    });
    await act(async () => {
      await result.current.releaseWakeLock();
    });
    expect(sentinels[0].release).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.requestWakeLock();
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('瀏覽器自行釋放（released=true）後會重新申請', async () => {
    const { sentinels, request } = installWakeLock();
    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await result.current.requestWakeLock();
    });
    // 分頁切到背景時瀏覽器會自動釋放並標記 released
    sentinels[0].released = true;

    await act(async () => {
      await result.current.requestWakeLock();
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('卸載時會釋放仍在申請中的 sentinel', async () => {
    let resolveRequest!: (sentinel: FakeSentinel) => void;
    const request = jest.fn(
      () =>
        new Promise<FakeSentinel>((resolve) => {
          resolveRequest = resolve;
        })
    );
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request },
      configurable: true,
      writable: true,
    });

    const { result, unmount } = renderHook(() => useWakeLock());
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.requestWakeLock();
    });

    unmount();

    const sentinel: FakeSentinel = {
      released: false,
      release: jest.fn(async () => {
        sentinel.released = true;
      }),
    };
    await act(async () => {
      resolveRequest(sentinel);
      await pending;
    });

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('不支援 Wake Lock 的瀏覽器不拋錯', async () => {
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    const { result } = renderHook(() => useWakeLock());

    await act(async () => {
      await expect(result.current.requestWakeLock()).resolves.toBeUndefined();
      await expect(result.current.releaseWakeLock()).resolves.toBeUndefined();
    });
  });
});
