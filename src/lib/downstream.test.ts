import { toSearchSimplified } from './chinese';
import type { ApiSite } from './config';
import { searchFromApi } from './downstream';
import { fetchSafeRemoteUrl } from './url-safety';

jest.mock('./url-safety', () => ({
  fetchSafeRemoteUrl: jest.fn(),
}));

const mockedFetchSafeRemoteUrl = fetchSafeRemoteUrl as jest.MockedFunction<
  typeof fetchSafeRemoteUrl
>;

function mockSearchResponse(list: unknown[] = []) {
  mockedFetchSafeRemoteUrl.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ list, pagecount: 1 }),
  } as Response);
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

describe('downstream query normalization', () => {
  const site = {
    key: 'test',
    api: 'https://example.test/api.php/provide/vod',
    name: 'Test',
  } as ApiSite;

  beforeEach(() => {
    jest.clearAllMocks();
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
        json: async () => ({ list: [], pagecount: 1 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          list: [
            {
              vod_id: 'hit',
              vod_name: '后备查询',
              vod_pic: '',
              vod_play_url: '1$https://example.test/1.m3u8',
            },
          ],
          pagecount: 1,
        }),
      } as Response);

    const results = await searchFromApi(site, '查询', [
      '精确查询',
      '后备查询',
      '不应执行',
    ]);

    expect(results).toHaveLength(1);
    expect(getCalledKeywords()).toEqual(['精确查询', '后备查询']);
  });

  it('keeps the original mainland source title while localizing metadata', async () => {
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

    expect(results[0]?.title).toBe('\u8fdb\u51fb\u7684\u5de8\u4eba');
    expect(results[0]?.type_name).toBe('\u52a8\u6f2b');
  });
});
