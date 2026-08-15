export const HLS_NETWORK_RETRY_LIMIT = 3;
export const HLS_SOFT_ERROR_MESSAGE = '播放失敗，可重新整理或換一個片源再試';

export type HlsFatalAction =
  | { type: 'startLoad' }
  | { type: 'recoverMedia' }
  | { type: 'giveUp'; message: string };

/**
 * 將 hls.js 致命錯誤收成可測的下一步。
 * 網路錯誤最多重試 HLS_NETWORK_RETRY_LIMIT 次，避免死 CDN 無限 startLoad。
 */
export function nextHlsFatalAction(
  errorType: string,
  networkRetries: number
): { action: HlsFatalAction; nextNetworkRetries: number } {
  if (errorType === 'networkError') {
    if (networkRetries < HLS_NETWORK_RETRY_LIMIT) {
      return {
        action: { type: 'startLoad' },
        nextNetworkRetries: networkRetries + 1,
      };
    }
    return {
      action: { type: 'giveUp', message: HLS_SOFT_ERROR_MESSAGE },
      nextNetworkRetries: networkRetries,
    };
  }

  if (errorType === 'mediaError') {
    return {
      action: { type: 'recoverMedia' },
      nextNetworkRetries: networkRetries,
    };
  }

  return {
    action: { type: 'giveUp', message: HLS_SOFT_ERROR_MESSAGE },
    nextNetworkRetries: networkRetries,
  };
}
