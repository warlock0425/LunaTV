import {
  HLS_MEDIA_ERROR_MESSAGE,
  HLS_MEDIA_RETRY_LIMIT,
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

  it('recovers media errors, then swaps audio codec, then gives up', () => {
    expect(nextHlsFatalAction('mediaError', 0, 0)).toEqual({
      action: { type: 'recoverMedia' },
      nextNetworkRetries: 0,
      nextMediaRetries: 1,
    });
    expect(nextHlsFatalAction('mediaError', 0, 1)).toEqual({
      action: { type: 'swapAudioCodec' },
      nextNetworkRetries: 0,
      nextMediaRetries: 2,
    });
    expect(nextHlsFatalAction('mediaError', 0, HLS_MEDIA_RETRY_LIMIT)).toEqual({
      action: { type: 'giveUp', message: HLS_MEDIA_ERROR_MESSAGE },
      nextNetworkRetries: 0,
      nextMediaRetries: HLS_MEDIA_RETRY_LIMIT,
    });
    expect(nextHlsFatalAction('muxError', 0).action.type).toBe('giveUp');
  });

  it('uses a custom give-up message for live playback', () => {
    expect(
      nextHlsFatalAction(
        'networkError',
        HLS_NETWORK_RETRY_LIMIT,
        0,
        '直播串流播放失敗，請嘗試其他頻道'
      ).action
    ).toEqual({
      type: 'giveUp',
      message: '直播串流播放失敗，請嘗試其他頻道',
    });
  });
});
