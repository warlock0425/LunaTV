import {
  HLS_NETWORK_RETRY_LIMIT,
  HLS_SOFT_ERROR_MESSAGE,
  nextHlsFatalAction,
} from './hls-fatal';

describe('nextHlsFatalAction', () => {
  it('retries network errors up to the limit then gives up', () => {
    expect(nextHlsFatalAction('networkError', 0).action).toEqual({
      type: 'startLoad',
    });
    expect(
      nextHlsFatalAction('networkError', HLS_NETWORK_RETRY_LIMIT - 1).action
    ).toEqual({ type: 'startLoad' });
    expect(
      nextHlsFatalAction('networkError', HLS_NETWORK_RETRY_LIMIT).action
    ).toEqual({ type: 'giveUp', message: HLS_SOFT_ERROR_MESSAGE });
  });

  it('recovers media errors and gives up on other fatal types', () => {
    expect(nextHlsFatalAction('mediaError', 2)).toEqual({
      action: { type: 'recoverMedia' },
      nextNetworkRetries: 2,
    });
    expect(nextHlsFatalAction('muxError', 0).action.type).toBe('giveUp');
  });

  it('uses a custom give-up message for live playback', () => {
    expect(
      nextHlsFatalAction(
        'networkError',
        HLS_NETWORK_RETRY_LIMIT,
        '直播串流播放失敗，請嘗試其他頻道'
      ).action
    ).toEqual({
      type: 'giveUp',
      message: '直播串流播放失敗，請嘗試其他頻道',
    });
  });
});
