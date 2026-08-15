import { act, renderHook } from '@testing-library/react';

import { useAutoNextCountdown } from './useAutoNextCountdown';

describe('useAutoNextCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('advances to the next episode after the countdown and can be cancelled', () => {
    const setCurrentEpisodeIndex = jest.fn();
    const detailRef = {
      current: { episodes: ['a', 'b', 'c'] } as { episodes: string[] },
    };
    const currentEpisodeIndexRef = { current: 0 };

    const { result } = renderHook(() =>
      useAutoNextCountdown({
        detailRef: detailRef as never,
        currentEpisodeIndexRef,
        setCurrentEpisodeIndex,
      })
    );

    act(() => {
      result.current.startAutoNextCountdown();
    });
    expect(result.current.showCountdownOverlay).toBe(true);
    expect(result.current.autoNextBusyRef.current).toBe(true);

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(setCurrentEpisodeIndex).toHaveBeenCalledWith(1);
    expect(result.current.showCountdownOverlay).toBe(false);

    act(() => {
      result.current.startAutoNextCountdown();
    });
    act(() => {
      result.current.cancelAutoNextCountdown();
    });
    expect(result.current.autoNextBusyRef.current).toBe(false);
    expect(result.current.showCountdownOverlay).toBe(false);
  });
});
