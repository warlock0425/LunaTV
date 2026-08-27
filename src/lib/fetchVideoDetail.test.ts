import { getAvailableApiSites } from '@/lib/config';

import { getDetailFromApi, searchFromApi } from './downstream';
import { fetchVideoDetail, isExactVideoDetail } from './fetchVideoDetail';
import { SearchResult } from './types';

jest.mock('@/lib/config', () => ({
  getAvailableApiSites: jest.fn(),
}));

jest.mock('./downstream', () => ({
  getDetailFromApi: jest.fn(),
  searchFromApi: jest.fn(),
}));

const mockedGetAvailableApiSites = getAvailableApiSites as jest.MockedFunction<
  typeof getAvailableApiSites
>;
const mockedSearchFromApi = searchFromApi as jest.MockedFunction<
  typeof searchFromApi
>;
const mockedGetDetailFromApi = getDetailFromApi as jest.MockedFunction<
  typeof getDetailFromApi
>;

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: '1',
    title: '測試影片',
    poster: '',
    episodes: ['ep1.m3u8'],
    episodes_titles: ['1'],
    source: 'test',
    source_name: '測試源',
    year: '',
    ...overrides,
  };
}

describe('isExactVideoDetail', () => {
  it('requires both source and id to match the original key', () => {
    expect(
      isExactVideoDetail({ source: 'test', id: 'old-id' }, 'test', 'old-id')
    ).toBe(true);
    expect(
      isExactVideoDetail({ source: 'test', id: 'new-id' }, 'test', 'old-id')
    ).toBe(false);
    expect(
      isExactVideoDetail({ source: 'other', id: 'old-id' }, 'test', 'old-id')
    ).toBe(false);
  });
});

describe('fetchVideoDetail', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedGetAvailableApiSites.mockResolvedValue([
      {
        key: 'test',
        name: '測試源',
        api: 'https://api.example.com',
      },
    ]);
  });

  it('does not return an exact search match that has no episodes', async () => {
    mockedSearchFromApi.mockResolvedValue([
      result({
        id: 'old-id',
        title: '尖帽子的魔法工房',
        episodes: [],
      }),
    ]);
    mockedGetDetailFromApi.mockResolvedValue(
      result({
        id: 'old-id',
        title: '尖帽子的魔法工房',
        episodes: ['1.m3u8', '2.m3u8'],
      })
    );

    const detail = await fetchVideoDetail({
      source: 'test',
      id: 'old-id',
      fallbackTitle: '尖帽子的魔法工房',
    });

    expect(detail.episodes).toEqual(['1.m3u8', '2.m3u8']);
    expect(mockedGetDetailFromApi).toHaveBeenCalled();
  });

  it('returns exact source/id search match before detail fallback', async () => {
    mockedSearchFromApi.mockResolvedValue([
      result({
        id: 'old-id',
        title: '尖帽子的魔法工房',
        episodes: ['1.m3u8', '2.m3u8'],
      }),
    ]);
    mockedGetDetailFromApi.mockRejectedValue(
      new Error('should not call detail')
    );

    const detail = await fetchVideoDetail({
      source: 'test',
      id: 'old-id',
      fallbackTitle: '尖帽子的魔法工房',
    });

    expect(detail.id).toBe('old-id');
    expect(detail.episodes).toHaveLength(2);
    expect(mockedGetDetailFromApi).not.toHaveBeenCalled();
  });

  it('falls back to the best same-source title match when original detail fails', async () => {
    mockedSearchFromApi.mockResolvedValue([
      result({
        id: 'new-id',
        title: '尖帽子的魔法工房',
        episodes: ['1.m3u8', '2.m3u8', '3.m3u8'],
      }),
      result({
        id: 'side-story',
        title: '尖帽子的魔法工房 特別篇',
        episodes: ['1.m3u8'],
      }),
    ]);
    mockedGetDetailFromApi.mockRejectedValue(new Error('詳情失效'));

    const detail = await fetchVideoDetail({
      source: 'test',
      id: 'old-id',
      fallbackTitle: '尖帽子的魔法工房',
    });

    expect(detail.id).toBe('new-id');
    expect(detail.episodes).toHaveLength(3);
  });

  it('does not fall back to a different season', async () => {
    mockedSearchFromApi.mockResolvedValue([
      result({
        id: 'season-3',
        title: '關於我轉生變成史萊姆這檔事 第三季',
        episodes: ['1.m3u8', '2.m3u8'],
      }),
    ]);
    mockedGetDetailFromApi.mockRejectedValue(new Error('詳情失效'));

    await expect(
      fetchVideoDetail({
        source: 'test',
        id: 'season-4-old',
        fallbackTitle: '關於我轉生變成史萊姆這檔事 第四季',
      })
    ).rejects.toThrow('取得影片詳情失敗');
  });

  it('prefers fresh detail api over search when preferDetailApi is set', async () => {
    mockedGetDetailFromApi.mockResolvedValue(
      result({
        id: 'old-id',
        title: '尖帽子的魔法工房',
        episodes: ['1.m3u8', '2.m3u8', '3.m3u8'],
      })
    );
    mockedSearchFromApi.mockResolvedValue([
      result({
        id: 'old-id',
        title: '尖帽子的魔法工房',
        episodes: ['1.m3u8', '2.m3u8'], // 搜尋快取中的舊集數
      }),
    ]);

    const detail = await fetchVideoDetail({
      source: 'test',
      id: 'old-id',
      fallbackTitle: '尖帽子的魔法工房',
      preferDetailApi: true,
    });

    expect(detail.episodes).toHaveLength(3);
    expect(mockedSearchFromApi).not.toHaveBeenCalled();
  });

  it('falls back to search match when preferDetailApi detail fails', async () => {
    mockedGetDetailFromApi.mockRejectedValue(new Error('詳情失效'));
    mockedSearchFromApi.mockResolvedValue([
      result({
        id: 'new-id',
        title: '尖帽子的魔法工房',
        episodes: ['1.m3u8', '2.m3u8'],
      }),
    ]);

    const detail = await fetchVideoDetail({
      source: 'test',
      id: 'old-id',
      fallbackTitle: '尖帽子的魔法工房',
      preferDetailApi: true,
    });

    expect(detail.id).toBe('new-id');
    // 詳情已在前面試過，不應重複請求
    expect(mockedGetDetailFromApi).toHaveBeenCalledTimes(1);
  });

  it('does not fall back from a base title to a special episode only result', async () => {
    mockedSearchFromApi.mockResolvedValue([
      result({
        id: 'special',
        title: '尖帽子的魔法工房 特別篇',
        episodes: ['1.m3u8'],
      }),
    ]);
    mockedGetDetailFromApi.mockRejectedValue(new Error('詳情失效'));

    await expect(
      fetchVideoDetail({
        source: 'test',
        id: 'old-id',
        fallbackTitle: '尖帽子的魔法工房',
      })
    ).rejects.toThrow('取得影片詳情失敗');
  });
});
