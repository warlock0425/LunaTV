export const HLS_NETWORK_RETRY_LIMIT = 3;
/** 媒體錯誤：先 recover，再 swapAudioCodec；之後放棄。 */
export const HLS_MEDIA_RETRY_LIMIT = 2;
export const HLS_SOFT_ERROR_MESSAGE = '播放失敗，可重新整理或換一個片源再試';
export const HLS_MEDIA_ERROR_MESSAGE = '媒體解碼失敗，請嘗試更換片源';

export type HlsFatalAction =
  | { type: 'startLoad' }
  | { type: 'recoverMedia' }
  | { type: 'swapAudioCodec' }
  | { type: 'giveUp'; message: string };

/**
 * 將 hls.js 致命錯誤收成可測的下一步。
 * 網路錯誤最多重試 HLS_NETWORK_RETRY_LIMIT 次，避免死 CDN 無限 startLoad。
 * 媒體錯誤最多 HLS_MEDIA_RETRY_LIMIT 次，避免壞音軌無限 recoverMediaError。
 */
export function nextHlsFatalAction(
  errorType: string,
  networkRetries: number,
  mediaRetries = 0,
  giveUpMessage?: string
): {
  action: HlsFatalAction;
  nextNetworkRetries: number;
  nextMediaRetries: number;
} {
  const networkGiveUp = giveUpMessage ?? HLS_SOFT_ERROR_MESSAGE;
  const mediaGiveUp = giveUpMessage ?? HLS_MEDIA_ERROR_MESSAGE;

  if (errorType === 'networkError') {
    if (networkRetries < HLS_NETWORK_RETRY_LIMIT) {
      return {
        action: { type: 'startLoad' },
        nextNetworkRetries: networkRetries + 1,
        nextMediaRetries: mediaRetries,
      };
    }
    return {
      action: { type: 'giveUp', message: networkGiveUp },
      nextNetworkRetries: networkRetries,
      nextMediaRetries: mediaRetries,
    };
  }

  if (errorType === 'mediaError') {
    if (mediaRetries < 1) {
      return {
        action: { type: 'recoverMedia' },
        nextNetworkRetries: networkRetries,
        nextMediaRetries: mediaRetries + 1,
      };
    }
    if (mediaRetries < HLS_MEDIA_RETRY_LIMIT) {
      return {
        action: { type: 'swapAudioCodec' },
        nextNetworkRetries: networkRetries,
        nextMediaRetries: mediaRetries + 1,
      };
    }
    return {
      action: { type: 'giveUp', message: mediaGiveUp },
      nextNetworkRetries: networkRetries,
      nextMediaRetries: mediaRetries,
    };
  }

  return {
    action: { type: 'giveUp', message: networkGiveUp },
    nextNetworkRetries: networkRetries,
    nextMediaRetries: mediaRetries,
  };
}
