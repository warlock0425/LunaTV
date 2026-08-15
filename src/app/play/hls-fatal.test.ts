import { HLS_NETWORK_RETRY_LIMIT, nextHlsFatalAction } from './hls-fatal';

describe('nextHlsFatalAction', () => {
  it('retries network errors up to the limit then gives up', () => {
    expect(nextHlsFatalAction('networkError', 0).action).toEqual({
      type: 'startLoad',
    });
    expect(
      nextHlsFatalAction('networkError', HLS_NETWORK_RETRY_LIMIT - 1).action
    ).toEqual({ type: 'startLoad' });
    expect(
      nextHlsFatalAction('networkError', HLS_NETWORK_RETRY_LIMIT).action.type
    ).toBe('giveUp');
  });

  it('recovers media errors and gives up on other fatal types', () => {
    expect(nextHlsFatalAction('mediaError', 2)).toEqual({
      action: { type: 'recoverMedia' },
      nextNetworkRetries: 2,
    });
    expect(nextHlsFatalAction('muxError', 0).action.type).toBe('giveUp');
  });
});
