import { renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';

import { useClientValue, useMounted } from './useClientMount';

describe('useMounted', () => {
  it('掛載後回傳 true', () => {
    const { result } = renderHook(() => useMounted());
    expect(result.current).toBe(true);
  });
});

describe('useClientValue', () => {
  it('掛載後回傳 read() 的結果', () => {
    const { result } = renderHook(() =>
      useClientValue(() => 'client', 'server')
    );
    expect(result.current).toBe('client');
  });

  it('read 回傳穩定參考時不會無限重渲染', () => {
    const stable = { list: [1, 2, 3] };
    const { result, rerender } = renderHook(() =>
      useClientValue(() => stable, null)
    );
    rerender();
    expect(result.current).toBe(stable);
  });
});
