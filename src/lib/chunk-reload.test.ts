import { isChunkLoadError, reloadOnceForStaleChunk } from './chunk-reload';

describe('chunk reload', () => {
  it('detects webpack / Next chunk load failures', () => {
    expect(isChunkLoadError(new Error('Loading chunk 123 failed'))).toBe(true);
    expect(
      isChunkLoadError(new Error('Failed to fetch dynamically imported module'))
    ).toBe(true);
    const named = new Error('import failed');
    named.name = 'ChunkLoadError';
    expect(isChunkLoadError(named)).toBe(true);
    expect(isChunkLoadError(new Error('network timeout'))).toBe(false);
  });

  it('only reloads once within the lock window', async () => {
    const reload = jest.fn();
    sessionStorage.clear();

    await expect(reloadOnceForStaleChunk(reload)).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    await expect(reloadOnceForStaleChunk(reload)).resolves.toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
