import {
  HLS_NETWORK_RETRY_LIMIT,
  HLS_SOFT_NETWORK_FAIL_LIMIT,
  isPlaylistUnchangedError,
  nextHlsFatalAction,
  tallySoftNetworkError,
} from './hls-fatal';

describe('tallySoftNetworkError', () => {
  it('ignores fatal errors and non-network types', () => {
    expect(
      tallySoftNetworkError(true, 'networkError', 'fragLoadError', 2)
    ).toEqual({ count: 2, escalate: false });
    expect(
      tallySoftNetworkError(false, 'mediaError', 'fragLoadError', 2)
    ).toEqual({ count: 2, escalate: false });
  });

  it('escalates after consecutive fragment or level load failures', () => {
    let count = 0;
    let escalate = false;
    for (let i = 0; i < HLS_SOFT_NETWORK_FAIL_LIMIT; i++) {
      const next = tallySoftNetworkError(
        false,
        'networkError',
        'fragLoadError',
        count
      );
      count = next.count;
      escalate = next.escalate;
    }
    expect(count).toBe(HLS_SOFT_NETWORK_FAIL_LIMIT);
    expect(escalate).toBe(true);
  });

  it('does not escalate a single timeout', () => {
    expect(
      tallySoftNetworkError(false, 'networkError', 'levelLoadTimeOut', 0)
    ).toEqual({ count: 1, escalate: false });
  });
});

describe('isPlaylistUnchangedError', () => {
  it('matches hls.js 1.7 stale live playlist details', () => {
    expect(isPlaylistUnchangedError('playlistUnchangedError')).toBe(true);
    expect(isPlaylistUnchangedError('fragLoadError')).toBe(false);
  });
});

describe('nextHlsFatalAction', () => {
  it('retries network errors then gives up', () => {
    const first = nextHlsFatalAction('networkError', 0, 0);
    expect(first.action.type).toBe('startLoad');
    const last = nextHlsFatalAction('networkError', HLS_NETWORK_RETRY_LIMIT, 0);
    expect(last.action.type).toBe('giveUp');
  });
});
