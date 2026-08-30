export const HLS_NETWORK_RETRY_LIMIT = 3;
/** 媒體錯誤：先 recover，再 swapAudioCodec；之後放棄。 */
export const HLS_MEDIA_RETRY_LIMIT = 2;
/** 非致命分片／層級載入失敗連續幾次後，當成無法恢復並走站內代理。 */
export const HLS_SOFT_NETWORK_FAIL_LIMIT = 3;
export const HLS_SOFT_ERROR_MESSAGE = '播放失敗，可重新整理或換一個片源再試';
export const HLS_MEDIA_ERROR_MESSAGE = '媒體解碼失敗，請嘗試更換片源';
export const HLS_LIVE_STALE_PLAYLIST_MESSAGE =
  '直播頻道已停止更新，請嘗試其他頻道';

const SOFT_NETWORK_DETAILS = new Set([
  'fragLoadError',
  'fragLoadTimeOut',
  'levelLoadError',
  'levelLoadTimeOut',
  'manifestLoadError',
  'manifestLoadTimeOut',
  'keyLoadError',
  'keyLoadTimeOut',
]);

/**
 * CORS／CDN 常讓分片載入一直失敗卻不變 fatal。累計到上限就該降級，
 * 不要空轉在直連。
 */
export function tallySoftNetworkError(
  fatal: boolean,
  errorType: string,
  details: string | undefined,
  currentCount: number
): { count: number; escalate: boolean } {
  if (
    fatal ||
    errorType !== 'networkError' ||
    !details ||
    !SOFT_NETWORK_DETAILS.has(details)
  ) {
    return { count: currentCount, escalate: false };
  }
  const count = currentCount + 1;
  return {
    count,
    escalate: count >= HLS_SOFT_NETWORK_FAIL_LIMIT,
  };
}

export function isPlaylistUnchangedError(details: string | undefined): boolean {
  return details === 'playlistUnchangedError';
}

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
