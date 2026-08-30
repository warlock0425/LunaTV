import type { SearchResult } from '@/lib/types';

export type VideoTestResult = {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  hasError?: boolean;
};

export function isMobileUserAgent(userAgent: string): boolean {
  return /Mobi|Android|iPhone|iPod|iPad|webOS|BlackBerry|IEMobile/i.test(
    userAgent
  );
}

/** SourceBuffer append 逾時（毫秒）。預設 Infinity 會讓壞源靜默掛住。 */
export const HLS_APPEND_TIMEOUT_MS = 20_000;
/** 直播 playlist 連續未更新幾次後觸發 PLAYLIST_UNCHANGED_ERROR */
export const HLS_LIVE_MAX_UNCHANGED_PLAYLIST_REFRESH = 5;

export function getVodHlsBufferConfig(isMobile: boolean): {
  maxBufferLength: number;
  backBufferLength: number;
  maxBufferSize: number;
} {
  return isMobile
    ? {
        maxBufferLength: 15,
        backBufferLength: 10,
        maxBufferSize: 20 * 1000 * 1000,
      }
    : {
        maxBufferLength: 30,
        backBufferLength: 15,
        maxBufferSize: 40 * 1000 * 1000,
      };
}

export function getLiveHlsBufferConfig(isMobile: boolean): {
  maxBufferLength: number;
  backBufferLength: number;
  maxBufferSize: number;
} {
  return isMobile
    ? {
        maxBufferLength: 12,
        backBufferLength: 8,
        maxBufferSize: 20 * 1000 * 1000,
      }
    : {
        maxBufferLength: 20,
        backBufferLength: 15,
        maxBufferSize: 40 * 1000 * 1000,
      };
}

function episodeUrlAt(episodes: string[], index: number): string | null {
  if (index < 0 || index >= episodes.length) return null;
  const url = typeof episodes[index] === 'string' ? episodes[index].trim() : '';
  return url || null;
}

/**
 * 畫質／速度測速要打哪一集的 URL。
 *
 * CMS `vod_play_url` 原樣收進 episodes，index 0 常是預告／花絮／重複條目
 * （見 downstream.parseVodPlayUrl，不過濾）。
 *
 * 換源請傳正在看的集數（點下去會播那集）。首播優選不要傳，改量第 2 集
 * 當代表畫質，避開預告。第 2 集空白時再退回第一個可播網址，不能整源放棄。
 *
 * 不適用：source-validation 等「能不能播」探針（仍可用 [0]）。
 */
export function pickSpeedTestEpisodeUrl(
  episodes: string[] | undefined | null,
  preferredIndex?: number
): string | null {
  if (!episodes || episodes.length === 0) return null;

  if (typeof preferredIndex === 'number') {
    const playing = episodeUrlAt(episodes, preferredIndex);
    if (playing) return playing;
  }

  if (episodes.length > 1) {
    const second = episodeUrlAt(episodes, 1);
    if (second) return second;
  }

  for (let index = 0; index < episodes.length; index++) {
    const url = episodeUrlAt(episodes, index);
    if (url) return url;
  }
  return null;
}

/** 換源／補詳情：有任一集播放網址即可，不套測速「避開 [0] 預告」規則。 */
export function pickFirstPlayableEpisodeUrl(
  episodes: string[] | undefined | null
): string | null {
  if (!episodes || episodes.length === 0) return null;
  for (const episode of episodes) {
    const url = typeof episode === 'string' ? episode.trim() : '';
    if (url) return url;
  }
  return null;
}

export function getResultEpisodeCount(
  item: Pick<SearchResult, 'episodes' | 'episode_count'>
): number {
  if (typeof item.episode_count === 'number' && item.episode_count > 0) {
    return item.episode_count;
  }
  return item.episodes?.length || 0;
}

/** 已載入、真的點得下去的播放網址條數（不含備註上的「更新至 N 集」）。 */
export function getLoadedEpisodeCount(
  item: Pick<SearchResult, 'episodes'> | null | undefined
): number {
  if (!item?.episodes?.length) return 0;
  let count = 0;
  for (const url of item.episodes) {
    if (typeof url === 'string' && url.trim()) count += 1;
  }
  return count;
}

/**
 * 與上游一致：選集 Tab 只在已載入超過 1 條播放網址時出現。
 * 備註「1184 集」只當提示，不能當成可點清單。
 */
export function getEpisodeSelectorCounts(
  item: Pick<SearchResult, 'episodes' | 'episode_count'> | null | undefined,
  fallbackLoaded = 0
): {
  loaded: number;
  advertised: number;
  showEpisodeTab: boolean;
} {
  const loaded = Math.max(getLoadedEpisodeCount(item), fallbackLoaded);
  const advertised =
    typeof item?.episode_count === 'number' && item.episode_count > 0
      ? Math.max(item.episode_count, loaded)
      : loaded;
  return {
    loaded,
    advertised,
    showEpisodeTab: loaded > 1,
  };
}

/**
 * 換源列要顯示的集數：已載入網址優先。
 * 探針只有 1 條時不要把備註「1184 集」畫成真實集數。
 */
export function getDisplayedSourceEpisodeCount(
  item: Pick<SearchResult, 'episodes' | 'episode_count'> | null | undefined
): number {
  const loaded = getLoadedEpisodeCount(item);
  if (loaded > 0) return loaded;
  if (!item) return 0;
  return getResultEpisodeCount(item);
}

const SOURCE_VERSION_TAG_RE =
  /\(([^)]+)\)|\[([^\]]+)\]|（([^）]+)）|(?:第[一二三四五六七八九十\d]+[季部])|(?:國語|粤語|粵語|4K|1080P|先行版|劇場版|無修|未刪減)/i;

/** 片源標題相對主片名多出來的版本標籤（國語、第 2 季、4K…）。 */
export function pickSourceVersionTag(
  sourceTitle: string | undefined | null,
  mainTitle: string | undefined | null
): string | null {
  const cleanTitle = (sourceTitle || '').trim();
  const main = (mainTitle || '').trim();
  if (!cleanTitle || cleanTitle === main) return null;
  const match = cleanTitle.match(SOURCE_VERSION_TAG_RE);
  const extraTag = match ? match[0] : null;
  if (extraTag && !main.includes(extraTag)) return extraTag;
  return null;
}

export const EPISODE_DESCENDING_STORAGE_KEY = 'player_episode_descending';

export function readEpisodeDescendingPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem(EPISODE_DESCENDING_STORAGE_KEY) === 'true'
    );
  } catch {
    return false;
  }
}

export function writeEpisodeDescendingPreference(descending: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      EPISODE_DESCENDING_STORAGE_KEY,
      String(descending)
    );
  } catch {
    /* quota / private mode */
  }
}

/** 點選集數超出已載入清單時夾到最後一集，不要直接說無集數。 */
export function resolveLoadedEpisodeIndex(
  requestedIndex: number,
  loadedCount: number
): { index: number; empty: boolean; clamped: boolean } {
  if (loadedCount <= 0) {
    return { index: 0, empty: true, clamped: false };
  }
  if (requestedIndex < 0) {
    return { index: 0, empty: false, clamped: true };
  }
  if (requestedIndex >= loadedCount) {
    return { index: loadedCount - 1, empty: false, clamped: true };
  }
  return { index: requestedIndex, empty: false, clamped: false };
}

/**
 * CMS 搜尋列若沒有完整 vod_play_url（或備註集數大於實際網址），換源前要打詳情。
 */
export function needsEpisodeHydration(
  source: Pick<SearchResult, 'episodes' | 'episode_count' | 'source' | 'id'>
): boolean {
  if (!source.source || source.id === undefined || source.id === null) {
    return false;
  }
  if (String(source.id) === '') return false;
  const urls = source.episodes || [];
  if (!pickFirstPlayableEpisodeUrl(urls)) return true;
  const count = getResultEpisodeCount(source);
  return count > 1 && urls.length < count;
}

/** 搜尋結果常沒有完整播放網址；測速／換源前打詳情補上。 */
export async function hydrateSearchResultEpisodes(
  source: SearchResult,
  signal?: AbortSignal,
  options?: { force?: boolean }
): Promise<SearchResult> {
  if (!options?.force && !needsEpisodeHydration(source)) return source;
  if (!source.source || !source.id) return source;

  const params = new URLSearchParams({
    source: String(source.source),
    id: String(source.id),
  });
  const response = await fetch(`/api/detail?${params.toString()}`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) return source;
  const detail = (await response.json()) as SearchResult;
  if (!detail?.episodes?.length) return source;

  return {
    ...source,
    episodes: detail.episodes,
    episodes_titles: detail.episodes_titles?.length
      ? detail.episodes_titles
      : detail.episodes.map((_, i) => `${i + 1}`),
    poster: source.poster || detail.poster,
    episode_count: detail.episodes.length,
  };
}

/** 長劇詳情偶發逾時：連打幾次，直到清單不再比備註集數短。 */
export async function hydrateSearchResultEpisodesWithRetry(
  source: SearchResult,
  signal?: AbortSignal,
  options?: { force?: boolean; attempts?: number }
): Promise<SearchResult> {
  const attempts = Math.max(1, options?.attempts ?? 3);
  let current = source;
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) return current;
    current = await hydrateSearchResultEpisodes(current, signal, {
      force: options?.force || i > 0,
    });
    const loaded = getLoadedEpisodeCount(current);
    const advertised = getResultEpisodeCount(current);
    if (loaded > 0 && loaded >= advertised) return current;
    if (!needsEpisodeHydration(current) && loaded > 0) return current;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
    }
  }
  return current;
}

/** 1080p 及以上：換源列表優先顯示的畫質 */
export function isPreferredDisplayQuality(
  quality: string | undefined | null
): boolean {
  if (!quality) return false;
  const q = quality.trim();
  return q === '4K' || q === '2K' || q === '1080p' || q === '1080P';
}

/**
 * 明確低於 1080p 的畫質。有任一 1080p+ 可用源時，列表應隱藏這些。
 * 「未知」不視為低畫質（測速未完成／無法解析時保守保留）。
 */
export function isBelowPreferredDisplayQuality(
  quality: string | undefined | null
): boolean {
  if (!quality) return false;
  const q = quality.trim();
  return (
    q === '720p' ||
    q === '480p' ||
    q === '360p' ||
    q === '240p' ||
    q === 'SD' ||
    q === '錯誤'
  );
}

export type SourceQualityInfo = {
  quality: string;
  hasError?: boolean;
};

/**
 * 換源「推薦」只給測過的 1080p+。沒有高畫質就不掛徽章，
 * 絕不把先測完的 480p／720p 當成推薦。
 */
/**
 * 播放失敗時自動換源：先找下一個已測過的 1080p+，否則下一個測過成功的源，再不然清單裡的下一個。
 */
export function pickNextPreferredSource<
  T extends { source?: string | number; id?: string | number },
>(
  sources: T[],
  options: {
    currentSource?: string | number | null;
    currentId?: string | number | null;
    getInfo: (sourceKey: string) => SourceQualityInfo | undefined;
  }
): T | null {
  const keyOf = (item: T) => `${item.source}-${item.id}`;
  const isCurrent = (item: T) =>
    item.source?.toString() === options.currentSource?.toString() &&
    item.id?.toString() === options.currentId?.toString();

  const others = sources.filter((item) => !isCurrent(item));
  if (others.length === 0) return null;

  const hd = others.find((item) => {
    const info = options.getInfo(keyOf(item));
    return !!info && !info.hasError && isPreferredDisplayQuality(info.quality);
  });
  if (hd) return hd;

  const testedOk = others.find((item) => {
    const info = options.getInfo(keyOf(item));
    return !!info && !info.hasError;
  });
  return testedOk || others[0] || null;
}

export function pickRecommendedSourceKey<
  T extends { source?: string | number; id?: string | number },
>(
  sources: T[],
  options: {
    currentSource?: string | number | null;
    currentId?: string | number | null;
    getInfo: (sourceKey: string) => SourceQualityInfo | undefined;
  }
): string | null {
  const keyOf = (s: T) => `${s.source}-${s.id}`;
  const isCurrent = (s: T) =>
    s.source?.toString() === options.currentSource?.toString() &&
    s.id?.toString() === options.currentId?.toString();

  const hd = sources.find((s) => {
    if (isCurrent(s)) return false;
    const info = options.getInfo(keyOf(s));
    return !!info && !info.hasError && isPreferredDisplayQuality(info.quality);
  });
  return hd ? keyOf(hd) : null;
}

/**
 * 換源列表畫質過濾：
 * - 若存在至少一個「測過且為 1080p+」的源 → 隱藏 720p／480p／SD 等
 * - 目前正在播的源永遠保留
 * - 尚未測速、連線失敗、畫質未知 → 保留（避免列表閃爍或以為沒源）
 * - 若完全沒有 1080p+ → 全部保留
 */
export function filterSourcesPreferHighQuality<
  T extends { source?: string | number; id?: string | number },
>(
  sources: T[],
  options: {
    currentSource?: string | number | null;
    currentId?: string | number | null;
    getInfo: (sourceKey: string) => SourceQualityInfo | undefined;
  }
): T[] {
  const keyOf = (s: T) => `${s.source}-${s.id}`;
  const isCurrent = (s: T) =>
    s.source?.toString() === options.currentSource?.toString() &&
    s.id?.toString() === options.currentId?.toString();

  const hasPreferred = sources.some((s) => {
    const info = options.getInfo(keyOf(s));
    return !!info && !info.hasError && isPreferredDisplayQuality(info.quality);
  });

  if (!hasPreferred) return sources;

  return sources.filter((s) => {
    if (isCurrent(s)) return true;
    const info = options.getInfo(keyOf(s));
    if (!info) return true;
    if (info.hasError) return true;
    if (isBelowPreferredDisplayQuality(info.quality)) return false;
    return true;
  });
}

const UNKNOWN_SPEED_LABELS = new Set(['未知', '測量中...']);

export function getStableTitle(
  ...titles: Array<string | undefined | null>
): string {
  return (
    titles
      .find((title) => {
        const value = title?.trim();
        return (
          value &&
          value !== 'undefined' &&
          value !== 'null' &&
          value !== '影片標題'
        );
      })
      ?.trim() || ''
  );
}

export function formatPlayerTime(seconds: number): string {
  if (seconds === 0) return '00:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.round(seconds % 60);

  if (hours === 0) {
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  }

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function parseLoadSpeedKBps(loadSpeed: string): number {
  if (!loadSpeed || UNKNOWN_SPEED_LABELS.has(loadSpeed)) return 0;

  const match = loadSpeed.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2];
  return unit === 'MB/s' ? value * 1024 : value;
}

/** 標題分組容差：與 preferBestSource 既有行為一致（max - 80） */
export const TITLE_MATCH_SAFE_MARGIN = 80;

/**
 * 標題安全組：分數距最高分不超過 margin 的候選。
 * 畫質／速度閘門必須在此之後，避免 1080p 但播錯片。
 */
export function filterTitleSafeCandidates<T extends { titleScore: number }>(
  candidates: T[],
  margin = TITLE_MATCH_SAFE_MARGIN
): T[] {
  if (candidates.length === 0) return [];
  const maxTitleScore = Math.max(...candidates.map((c) => c.titleScore));
  return candidates.filter((c) => c.titleScore >= maxTitleScore - margin);
}

export type SpeedTestedCandidate<T = unknown> = {
  source: T;
  testResult: VideoTestResult;
  titleScore: number;
};

/**
 * 全部測速完成後的首播選擇（無「命中即起播」時）。
 * 順序：標題安全組 → 組內若有 1080p+ 只從其中選 → 否則整組退回評分（fellBackWithoutHd）。
 * 「未知」畫質不算 1080p+（與 isPreferredDisplayQuality 一致），可參與退回評分。
 */
export function selectSourceAfterSpeedTests<T>(
  successful: Array<SpeedTestedCandidate<T>>
): { source: T; fellBackWithoutHd: boolean } | null {
  if (successful.length === 0) return null;

  const titleSafe = filterTitleSafeCandidates(successful);
  const pool = titleSafe.length > 0 ? titleSafe : successful;

  const hdPool = pool.filter((c) =>
    isPreferredDisplayQuality(c.testResult.quality)
  );
  const usePool = hdPool.length > 0 ? hdPool : pool;
  const fellBackWithoutHd = hdPool.length === 0;

  const validSpeeds = usePool
    .map((result) => parseLoadSpeedKBps(result.testResult.loadSpeed))
    .filter((speed) => speed > 0);
  const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024;

  const validPings = usePool
    .map((result) => result.testResult.pingTime)
    .filter((ping) => ping > 0);
  const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
  const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

  const ranked = usePool
    .map((result) => ({
      ...result,
      sourceScore: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      ),
    }))
    .sort((a, b) => b.sourceScore - a.sourceScore);

  return {
    source: ranked[0].source,
    fellBackWithoutHd,
  };
}

export function calculateSourceScore(
  testResult: VideoTestResult,
  _maxSpeed: number,
  _minPing: number,
  _maxPing: number
): number {
  let score = 0;

  const qualityScore = (() => {
    switch (testResult.quality) {
      case '4K':
        return 100;
      case '2K':
        return 85;
      case '1080p':
        return 75;
      case '720p':
        return 60;
      case '480p':
        return 40;
      case 'SD':
        return 20;
      default:
        return 0;
    }
  })();
  score += qualityScore * 0.4;

  const speedKBps = parseLoadSpeedKBps(testResult.loadSpeed);

  const speedScore = (() => {
    if (UNKNOWN_SPEED_LABELS.has(testResult.loadSpeed)) return 30;
    if (speedKBps >= 5 * 1024) return 100;
    if (speedKBps >= 3 * 1024) return 95;
    if (speedKBps >= 2 * 1024) return 90;
    if (speedKBps >= 1 * 1024) return 80;
    if (speedKBps >= 500) return 65;
    if (speedKBps >= 200) return 40;
    if (speedKBps > 0) return 20;
    return 10;
  })();
  score += speedScore * 0.4;

  const pingScore = (() => {
    const ping = testResult.pingTime;
    if (ping <= 0) return 10;
    if (ping < 50) return 100;
    if (ping < 100) return 95;
    if (ping < 200) return 85;
    if (ping < 400) return 70;
    if (ping < 800) return 50;
    if (ping < 1500) return 30;
    return 10;
  })();
  score += pingScore * 0.2;

  const isHighQuality = ['1080p', '2K', '4K'].includes(testResult.quality);
  if (isHighQuality && speedKBps >= 500) {
    score += 50;
  }

  return Math.round(score * 100) / 100;
}
