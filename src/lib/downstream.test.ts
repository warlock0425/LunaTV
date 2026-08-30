import { toSearchSimplified } from './chinese';
import { type ApiSite, getConfig } from './config';
import {
  DownstreamNotFoundError,
  DownstreamTimeoutError,
  DownstreamUpstreamError,
  getDetailFromApi,
  parseEpisodeCountFromRemarks,
  parseVodPlayUrl,
  searchFromApi,
} from './downstream';
import { resetOutboundGateForTests } from './outbound-gate';
import { clearSearchCacheForTests } from './search-cache';
import {
  recordSourceFailure,
  recordSourceSuccess,
} from './source-circuit-breaker';
import { fetchSafeRemoteUrl, readResponseJsonWithLimit } from './url-safety';

jest.mock('./config', () => {
  const actual = jest.requireActual<typeof import('./config')>('./config');
  return { ...actual, getConfig: jest.fn() };
});
jest.mock('./source-circuit-breaker', () => ({
  isSourceTripped: jest.fn(() => false),
  recordSourceFailure: jest.fn(),
  recordSourceSuccess: jest.fn(),
}));
jest.mock('./url-safety', () => ({
  fetchSafeRemoteUrl: jest.fn(),
  readResponseJsonWithLimit: jest.fn(),
  readResponseTextWithLimit: jest.fn(),
}));

const mockedFetchSafeRemoteUrl = fetchSafeRemoteUrl as jest.MockedFunction<
  typeof fetchSafeRemoteUrl
>;
const mockedReadResponseJsonWithLimit =
  readResponseJsonWithLimit as jest.MockedFunction<
    typeof readResponseJsonWithLimit
  >;
const mockedGetConfig = jest.mocked(getConfig);
const mockedRecordSourceFailure = jest.mocked(recordSourceFailure);
const mockedRecordSourceSuccess = jest.mocked(recordSourceSuccess);

function mockSearchResponse(list: unknown[] = []) {
  const response = {
    ok: true,
    status: 200,
  } as Response;
  mockedFetchSafeRemoteUrl.mockResolvedValue(response);
  mockedReadResponseJsonWithLimit.mockResolvedValue({ list, pagecount: 1 });
}

function getCalledKeyword(callIndex = 0): string {
  const calledUrl = mockedFetchSafeRemoteUrl.mock.calls[callIndex]?.[0];
  expect(typeof calledUrl).toBe('string');
  const url = calledUrl as string;
  const keyword = new URL(url).searchParams.get('wd');
  expect(keyword).toBeTruthy();
  return keyword || '';
}

function getCalledKeywords(): string[] {
  return mockedFetchSafeRemoteUrl.mock.calls.map((call) => {
    const url = call[0] as string;
    return new URL(url).searchParams.get('wd') || '';
  });
}

describe('parseVodPlayUrl', () => {
  it('accepts title-less urls and urls that themselves contain $', () => {
    expect(
      parseVodPlayUrl(
        [
          'https://cdn.example/1.m3u8',
          '第2集$https://cdn.example/$token/2.m3u8?sign=1',
        ].join('#')
      ).episodes
    ).toEqual([
      'https://cdn.example/1.m3u8',
      'https://cdn.example/$token/2.m3u8?sign=1',
    ]);
  });
});

describe('parseEpisodeCountFromRemarks', () => {
  it('parses common CMS remark formats', () => {
    expect(parseEpisodeCountFromRemarks('更新至24集')).toBe(24);
    expect(parseEpisodeCountFromRemarks('更新至第12集')).toBe(12);
    expect(parseEpisodeCountFromRemarks('全36集')).toBe(36);
    expect(parseEpisodeCountFromRemarks('第8集')).toBe(8);
    expect(parseEpisodeCountFromRemarks('HD')).toBe(0);
    expect(parseEpisodeCountFromRemarks('')).toBe(0);
  });
});

describe('downstream query normalization', () => {
  const site = {
    key: 'test',
    api: 'https://example.test/api.php/provide/vod',
    name: 'Test',
  } as ApiSite;

  beforeEach(() => {
    jest.clearAllMocks();
    clearSearchCacheForTests();
    resetOutboundGateForTests();
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { SearchDownstreamMaxPage: 5 },
    } as Awaited<ReturnType<typeof getConfig>>);
  });

  it('normalizes traditional query to simplified before calling upstream', async () => {
    mockSearchResponse();

    await searchFromApi(site, '\u9032\u64ca\u7684\u5de8\u4eba');

    expect(getCalledKeywords()).toContain(
      toSearchSimplified('\u9032\u64ca\u7684\u5de8\u4eba')
    );
    expect(getCalledKeywords()).not.toContain('\u9032\u64ca\u7684\u5de8\u4eba');
  });

  it('normalizes precomputed variants to simplified before calling upstream', async () => {
    mockSearchResponse();

    await searchFromApi(site, 'Dr.STONE', ['\u5be6\u969b\u77f3\u7d00\u5143']);

    expect(mockedFetchSafeRemoteUrl).toHaveBeenCalledTimes(1);
    expect(getCalledKeyword()).toBe(
      toSearchSimplified('\u5be6\u969b\u77f3\u7d00\u5143')
    );
  });

  it('deduplicates variants after simplification while preserving order', async () => {
    mockSearchResponse();

    await searchFromApi(site, '\u9032\u64ca\u7684\u5de8\u4eba', [
      '\u9032\u64ca\u7684\u5de8\u4eba',
      '\u8fdb\u51fb\u7684\u5de8\u4eba',
      '   ',
    ]);

    const keywords = getCalledKeywords();
    expect(keywords).toEqual(Array.from(new Set(keywords)));
    expect(keywords).not.toContain('');
    expect(keywords).toContain(
      toSearchSimplified('\u9032\u64ca\u7684\u5de8\u4eba')
    );
  });

  it('tries variants sequentially and stops after the first successful query', async () => {
    mockedFetchSafeRemoteUrl
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      } as Response);
    mockedReadResponseJsonWithLimit
      .mockResolvedValueOnce({ list: [], pagecount: 1 })
      .mockResolvedValueOnce({
        list: [
          {
            vod_id: 'hit',
            vod_name: '后备查询',
            vod_pic: '',
            vod_play_url: '1$https://example.test/1.m3u8',
          },
        ],
        pagecount: 1,
      });

    const results = await searchFromApi(site, '查询', [
      '精确查询',
      '后备查询',
      '不应执行',
    ]);

    expect(results).toHaveLength(1);
    expect(getCalledKeywords()).toEqual(['精确查询', '后备查询']);
  });

  it('keeps the original mainland source title (no display conversion)', async () => {
    mockSearchResponse([
      {
        vod_id: '1',
        vod_name: '\u8fdb\u51fb\u7684\u5de8\u4eba',
        vod_pic: 'https://example.test/poster.jpg',
        vod_play_url: '1$https://example.test/1.m3u8',
        type_name: '\u52a8\u6f2b',
      },
    ]);

    const results = await searchFromApi(
      site,
      '\u9032\u64ca\u7684\u5de8\u4eba',
      ['\u9032\u64ca\u7684\u5de8\u4eba']
    );

    // 片名／簡介維持 CMS 原文，不做顯示層繁體化
    expect(results[0]?.title).toBe('\u8fdb\u51fb\u7684\u5de8\u4eba');
    expect(results[0]?.type_name).toBe('\u52a8\u6f2b');
    expect(results[0]?.episodes[0]).toBe('https://example.test/1.m3u8');
  });

  it('records success only after an OK response has valid JSON', async () => {
    mockedFetchSafeRemoteUrl.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
    mockedReadResponseJsonWithLimit.mockRejectedValue(
      new SyntaxError('invalid JSON')
    );

    await searchFromApi(site, 'invalid-json', ['invalid-json']);

    expect(mockedRecordSourceSuccess).not.toHaveBeenCalled();
    expect(mockedRecordSourceFailure).toHaveBeenCalledWith('test');
  });

  it('does not fetch extra pages on the search hot path', async () => {
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { SearchDownstreamMaxPage: 1000 },
    } as Awaited<ReturnType<typeof getConfig>>);
    mockedFetchSafeRemoteUrl.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
    mockedReadResponseJsonWithLimit.mockResolvedValue({
      list: [
        {
          vod_id: 'hit',
          vod_name: 'fanout-query',
          vod_pic: '',
          vod_play_url: '1$https://example.test/1.m3u8',
        },
      ],
      pagecount: 1000,
    });

    await searchFromApi(site, 'fanout-query', ['fanout-query']);

    expect(mockedFetchSafeRemoteUrl).toHaveBeenCalledTimes(1);
  });

  it('caps hot-path variants at the runtime max', async () => {
    mockSearchResponse([]);

    await searchFromApi(site, 'variant-cap', [
      '第一變體',
      '第二變體',
      '第三變體',
      '不該打到',
    ]);

    expect(getCalledKeywords()).toEqual(['第一变体', '第二变体', '第三变体']);
  });

  it('keeps listings that have no playable episodes', async () => {
    mockSearchResponse([
      {
        vod_id: 'bare',
        vod_name: '只有標題',
      },
    ]);

    const results = await searchFromApi(site, 'zero-episode-probe', [
      'zero-episode-probe',
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'bare',
      title: '只有標題',
      episodes: [],
      episode_count: 0,
    });
  });

  it('reads episode_count from vod_remarks when search JSON has no play URL', async () => {
    mockSearchResponse([
      {
        vod_id: 'remark-24',
        vod_name: '備註集數劇',
        vod_remarks: '更新至24集',
      },
    ]);

    const results = await searchFromApi(site, 'remarks-episode-probe', [
      'remarks-episode-probe',
    ]);

    expect(results[0]?.episode_count).toBe(24);
    expect(results[0]?.episodes).toEqual([]);
  });

  it('skips malformed rows instead of discarding the whole source', async () => {
    // 採集站常有缺欄位的髒資料。整段 map 只要拋一次，外層 catch 就會把
    // 這個片源的所有結果變成空陣列——等於整站搜不到東西。
    mockSearchResponse([
      { vod_name: 'malformed-no-id', vod_play_url: '1$https://x.test/1.m3u8' },
      {
        vod_id: null,
        vod_name: 'null-id',
        vod_play_url: '1$https://x.test/1.m3u8',
      },
      { vod_id: '2', vod_play_url: '1$https://x.test/2.m3u8' },
      { vod_id: '3', vod_name: '   ', vod_play_url: '1$https://x.test/3.m3u8' },
      { vod_id: '4', vod_name: 'malformed-row-probe', vod_year: 12345 },
      {
        vod_id: 5,
        vod_name: 'malformed-row-probe',
        vod_pic: 'https://x.test/p.jpg',
        vod_play_url: '1$https://x.test/good.m3u8',
      },
    ]);

    const results = await searchFromApi(site, 'malformed-row-probe', [
      'malformed-row-probe',
    ]);

    expect(results.map((item) => item.id)).toEqual(['4', '5']);
    expect(results[1]).toMatchObject({
      id: '5',
      title: 'malformed-row-probe',
      episodes: ['https://x.test/good.m3u8'],
    });
  });

  it('does not let one caller aborting kill the shared upstream request', async () => {
    // searchWithCache 的 fetch 是經由 deduplicateRequest 共用的。若把單一
    // 呼叫端的 signal 綁上去，某位使用者離開頁面就會中止共用請求，
    // 其他併發的使用者也會一起拿到空結果。
    let upstreamSignal: AbortSignal | undefined;
    mockedFetchSafeRemoteUrl.mockImplementation(async (_url, init) => {
      upstreamSignal = init?.signal as AbortSignal;
      return { ok: true, status: 200 } as Response;
    });
    mockedReadResponseJsonWithLimit.mockResolvedValue({
      list: [
        {
          vod_id: '1',
          vod_name: 'shared-abort-probe',
          vod_pic: '',
          vod_play_url: '1$https://x.test/1.m3u8',
        },
      ],
      pagecount: 1,
    });

    const controller = new AbortController();
    const pending = searchFromApi(
      site,
      'shared-abort-probe',
      ['shared-abort-probe'],
      controller.signal
    );
    controller.abort();

    await expect(pending).resolves.toHaveLength(1);
    expect(upstreamSignal).toBeDefined();
    expect(upstreamSignal?.aborted).toBe(false);
  });

  it('skips the request entirely when the caller aborted before starting', async () => {
    mockSearchResponse([]);
    const controller = new AbortController();
    controller.abort();

    const results = await searchFromApi(
      site,
      'pre-aborted-probe',
      ['pre-aborted-probe'],
      controller.signal
    );

    expect(results).toEqual([]);
    expect(mockedFetchSafeRemoteUrl).not.toHaveBeenCalled();
  });
});

describe('downstream detail errors', () => {
  const site = {
    key: 'test',
    api: 'https://example.test/api.php/provide/vod',
    name: 'Test',
  } as ApiSite;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports an upstream 404 as not found', async () => {
    mockedFetchSafeRemoteUrl.mockResolvedValue({
      ok: false,
      status: 404,
      body: null,
    } as Response);

    await expect(getDetailFromApi(site, 'missing')).rejects.toBeInstanceOf(
      DownstreamNotFoundError
    );
  });

  it('reports an upstream HTTP failure separately from not found', async () => {
    mockedFetchSafeRemoteUrl.mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
    } as Response);

    await expect(getDetailFromApi(site, 'unavailable')).rejects.toMatchObject({
      name: DownstreamUpstreamError.name,
      status: 503,
    });
  });

  it('keeps the timeout active while the response body is being parsed', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | null = null;
    let markReadStarted!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });

    mockedFetchSafeRemoteUrl.mockImplementation(async (_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return { ok: true, status: 200 } as Response;
    });
    mockedReadResponseJsonWithLimit.mockImplementation(
      () =>
        new Promise((_, reject) => {
          markReadStarted();
          requestSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        })
    );

    const detailPromise = getDetailFromApi(site, 'slow-body');
    await readStarted;

    jest.advanceTimersByTime(25000);

    await expect(detailPromise).rejects.toBeInstanceOf(DownstreamTimeoutError);
  });

  it('treats malformed upstream JSON as an upstream failure', async () => {
    mockedFetchSafeRemoteUrl.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
    mockedReadResponseJsonWithLimit.mockRejectedValue(
      new SyntaxError('invalid JSON')
    );

    await expect(getDetailFromApi(site, 'invalid-json')).rejects.toBeInstanceOf(
      DownstreamUpstreamError
    );
  });
});

/**
 * 集數解析是「集數更新」的關鍵路徑：cron 的追更、播放頁的「檢查更新」、
 * 換源後的背景刷新全都經由 getDetailFromApi。這裡把解析行為釘死，
 * 確保 vod_play_url 的拆解規則與 year 的哨兵值語意不被重構改掉。
 */
describe('downstream detail episode parsing', () => {
  const site = {
    key: 'test',
    api: 'https://example.test/api.php/provide/vod',
    name: 'Test',
  } as ApiSite;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchSafeRemoteUrl.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
  });

  function mockDetail(videoDetail: Record<string, unknown>) {
    mockedReadResponseJsonWithLimit.mockResolvedValue({ list: [videoDetail] });
  }

  it('在多個播放組中選出集數最多的一組', async () => {
    mockDetail({
      vod_name: '測試劇',
      vod_play_url: [
        '1$https://a.test/1.m3u8#2$https://a.test/2.m3u8',
        '1$https://b.test/1.m3u8#2$https://b.test/2.m3u8#3$https://b.test/3.m3u8',
        '1$https://c.test/1.m3u8',
      ].join('$$$'),
    });

    const detail = await getDetailFromApi(site, '1');

    expect(detail.episodes).toEqual([
      'https://b.test/1.m3u8',
      'https://b.test/2.m3u8',
      'https://b.test/3.m3u8',
    ]);
    expect(detail.episodes_titles).toEqual(['1', '2', '3']);
  });

  it('略過非 m3u8 的播放位址，並保留帶查詢參數的 m3u8', async () => {
    mockDetail({
      vod_name: '測試劇',
      vod_play_url: [
        '1$https://a.test/1.mp4',
        '2$https://a.test/2.m3u8?sign=abc',
        '3$not-a-url',
        '4$https://a.test/4.m3u8',
      ].join('#'),
    });

    const detail = await getDetailFromApi(site, '1');

    expect(detail.episodes).toEqual([
      'https://a.test/2.m3u8?sign=abc',
      'https://a.test/4.m3u8',
    ]);
    expect(detail.episodes_titles).toEqual(['2', '4']);
  });

  it('沒有 vod_play_url 時退回從 vod_content 掃 m3u8', async () => {
    mockDetail({
      vod_name: '測試劇',
      vod_content: '看這裡 https://a.test/x.m3u8 還有 https://a.test/y.m3u8',
    });

    const detail = await getDetailFromApi(site, '1');

    expect(detail.episodes).toEqual([
      'https://a.test/x.m3u8',
      'https://a.test/y.m3u8',
    ]);
  });

  it('year 缺漏時填哨兵值 unknown，有值時取四位年份', async () => {
    mockDetail({ vod_name: 'A', vod_play_url: '1$https://a.test/1.m3u8' });
    expect((await getDetailFromApi(site, '1')).year).toBe('unknown');

    mockDetail({
      vod_name: 'A',
      vod_year: '',
      vod_play_url: '1$https://a.test/1.m3u8',
    });
    expect((await getDetailFromApi(site, '1')).year).toBe('unknown');

    mockDetail({
      vod_name: 'A',
      vod_year: '2024-05-01',
      vod_play_url: '1$https://a.test/1.m3u8',
    });
    expect((await getDetailFromApi(site, '1')).year).toBe('2024');
  });

  it('數字型 vod_year 不再讓整筆詳情失敗', async () => {
    mockDetail({
      vod_name: 'A',
      vod_year: 2024,
      vod_play_url: '1$https://a.test/1.m3u8',
    });

    const detail = await getDetailFromApi(site, '1');
    expect(detail.year).toBe('2024');
    expect(detail.episodes).toHaveLength(1);
  });

  it('缺少 vod_name 時仍回傳集數（追更不該因為標題缺漏而中斷）', async () => {
    mockDetail({ vod_play_url: '1$https://a.test/1.m3u8' });

    const detail = await getDetailFromApi(site, '1');
    expect(detail.title).toBe('');
    expect(detail.episodes).toEqual(['https://a.test/1.m3u8']);
  });
});

describe('downstream detail 邊界情況', () => {
  const site = {
    key: 'test',
    api: 'https://example.test/api.php/provide/vod',
    name: 'Test',
  } as ApiSite;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFetchSafeRemoteUrl.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
  });

  it('list[0] 為 null 時視為查無資料，而非回傳零集數的空詳情', async () => {
    // 放行的話端點會回 200 + episodes:[]，播放頁得到空播放器而不是明確錯誤
    mockedReadResponseJsonWithLimit.mockResolvedValue({ list: [null] });

    await expect(getDetailFromApi(site, '1')).rejects.toBeInstanceOf(
      DownstreamNotFoundError
    );
  });

  it('list[0] 非物件時同樣視為查無資料', async () => {
    mockedReadResponseJsonWithLimit.mockResolvedValue({ list: ['oops'] });

    await expect(getDetailFromApi(site, '1')).rejects.toBeInstanceOf(
      DownstreamNotFoundError
    );
  });
});

describe('downstream 標題空白正規化', () => {
  const site = {
    key: 'test',
    api: 'https://example.test/api.php/provide/vod',
    name: 'Test',
  } as ApiSite;

  beforeEach(() => {
    jest.clearAllMocks();
    clearSearchCacheForTests();
    resetOutboundGateForTests();
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { SearchDownstreamMaxPage: 1 },
    } as Awaited<ReturnType<typeof getConfig>>);
    mockedFetchSafeRemoteUrl.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
  });

  // 兩條路徑對同一部片若回傳不同空白的標題，會讓顯示、播放紀錄存的標題、
  // 以及依「標題完全相等」比對的客戶端（如 OrionTV）對不上。
  it('詳情路徑與搜尋路徑對同一標題產生一致結果', async () => {
    const messy = '  鬼滅之刃   無限列車篇\t ';
    const expected = '鬼滅之刃 無限列車篇';

    mockedReadResponseJsonWithLimit.mockResolvedValue({
      list: [
        {
          vod_id: '1',
          vod_name: messy,
          vod_play_url: '1$https://a.test/1.m3u8',
        },
      ],
      pagecount: 1,
    });
    const detail = await getDetailFromApi(site, '1');
    expect(detail.title).toBe(expected);

    const results = await searchFromApi(site, 'whitespace-probe', [
      'whitespace-probe',
    ]);
    expect(results[0]?.title).toBe(expected);
  });
});

/**
 * 上游解析的 golden test。
 *
 * 為什麼要斷言「整個物件」而不是挑欄位：v2.8.3 那次我把 year 的哨兵值從
 * 'unknown' 改成 ''，618 個測試全綠——因為當時沒有任何一條測試斷言 year。
 * 這類「假設漂移」是型別檢查與逐欄位斷言都攔不到的：測試把跟程式碼同一套
 * 假設寫死，程式改了假設，測試就跟著一起改。
 *
 * 改成整體快照後，任何欄位的語意變動都會以 diff 的形式浮出來，即使沒人
 * 特別關心那個欄位。要刻意變更時用 `pnpm test -- -u` 更新，並在 review
 * 時把 diff 看過一遍。
 *
 * 刻意不使用真實片源回應當 fixture：本 repo 因法律考量不得含片源資訊
 * （2026-07-16 已為此重置整個歷史，config.json 亦永不進版控）。下方樣本
 * 涵蓋的邊界情況比真實 happy-path 回應更完整。
 */
describe('上游解析 golden test', () => {
  const site = {
    key: 'goldensrc',
    api: 'https://example.test/api.php/provide/vod',
    name: '黃金測試源',
  } as ApiSite;

  beforeEach(() => {
    jest.clearAllMocks();
    clearSearchCacheForTests();
    resetOutboundGateForTests();
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { SearchDownstreamMaxPage: 1 },
    } as Awaited<ReturnType<typeof getConfig>>);
    mockedFetchSafeRemoteUrl.mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
  });

  it('搜尋結果的完整解析輸出', async () => {
    mockedReadResponseJsonWithLimit.mockResolvedValue({
      pagecount: 1,
      list: [
        {
          // 一般情況：多播放組，取集數最多的那一組
          vod_id: 4801,
          vod_name: '  黃金劇   第一季 ',
          vod_pic: 'https://img.example.test/a.jpg',
          vod_play_url: [
            '1$https://a.example.test/1.m3u8#2$https://a.example.test/2.m3u8',
            '1$https://b.example.test/1.m3u8#2$https://b.example.test/2.m3u8#3$https://b.example.test/3.m3u8',
          ].join('$$$'),
          vod_class: '動作,冒險',
          vod_year: '2024-05-01',
          vod_content: '<p>簡介裡有 <b>HTML</b> 標籤</p>',
          type_name: '動漫',
          vod_douban_id: 12345,
        },
        {
          // vod_year 為數字（曾讓整批解析失敗）、無 class/desc/douban_id
          vod_id: '4802',
          vod_name: '數字年份劇',
          vod_pic: '',
          vod_play_url: '1$https://a.example.test/x.m3u8',
          vod_year: 2019,
        },
        {
          // vod_year 為空字串 → 應維持哨兵值 unknown
          vod_id: '4803',
          vod_name: '無年份劇',
          vod_pic: '',
          vod_play_url: '1$https://a.example.test/y.m3u8?sign=abc',
          vod_year: '',
        },
        // 以下全部應被丟棄，但不得影響上面三筆
        { vod_name: '缺 id', vod_play_url: '1$https://a.example.test/z.m3u8' },
        { vod_id: '4804', vod_play_url: '1$https://a.example.test/z.m3u8' },
        {
          vod_id: '4805',
          vod_name: '   ',
          vod_play_url: '1$https://a.example.test/z.m3u8',
        },
        {
          vod_id: '4806',
          vod_name: '無可播位址',
          vod_play_url: '1$https://a.example.test/z.mp4',
        },
        { vod_id: '4807', vod_name: '完全沒有播放欄位' },
      ],
    });

    const results = await searchFromApi(site, 'golden-search-probe', [
      'golden-search-probe',
    ]);

    expect(results).toMatchSnapshot();
  });

  it('詳情的完整解析輸出', async () => {
    mockedReadResponseJsonWithLimit.mockResolvedValue({
      list: [
        {
          vod_name: '黃金劇  詳情',
          vod_pic: 'https://img.example.test/d.jpg',
          vod_play_url: [
            '第1集$https://a.example.test/d1.m3u8',
            '第2集$https://a.example.test/d2.m3u8?token=zz',
            '預告$https://a.example.test/trailer.mp4',
          ].join('#'),
          vod_class: '劇情',
          vod_year: '2023',
          vod_content: '詳情簡介 &amp; 實體編碼',
          type_name: '電視劇',
          vod_douban_id: 999,
        },
      ],
    });

    await expect(getDetailFromApi(site, '4801')).resolves.toMatchSnapshot();
  });

  it('詳情在無播放欄位時退回從簡介掃 m3u8', async () => {
    mockedReadResponseJsonWithLimit.mockResolvedValue({
      list: [
        {
          vod_name: '簡介夾帶位址',
          vod_content:
            '看這裡 https://a.example.test/c1.m3u8 或 https://a.example.test/c2.m3u8',
        },
      ],
    });

    await expect(getDetailFromApi(site, '4802')).resolves.toMatchSnapshot();
  });
});
