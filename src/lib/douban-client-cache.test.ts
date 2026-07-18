/**
 * 豆瓣直連請求的 sessionStorage 快取行為測試。
 * 透過公開的 fetchDoubanCategories 間接驗證 fetchDoubanJson 快取層。
 */
import { fetchDoubanCategories } from './douban.client';

const API_RESPONSE = {
  items: [
    {
      id: '1',
      title: '測試電影',
      pic: { normal: 'https://img.example/p.jpg', large: '' },
      rating: { value: 8.8 },
      year: '2026',
    },
  ],
  total: 1,
};

function mockFetchOnce() {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => API_RESPONSE,
  });
}

describe('豆瓣直連 sessionStorage 快取', () => {
  const params = {
    kind: 'movie' as const,
    category: '熱門',
    type: '全部',
    pageLimit: 20,
    pageStart: 0,
  };

  beforeEach(() => {
    sessionStorage.clear();
    global.fetch = jest.fn();
    mockFetchOnce();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('相同請求第二次命中快取，不再發出網路請求', async () => {
    const first = await fetchDoubanCategories(params, '');
    const second = await fetchDoubanCategories(params, '');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first.list[0].title).toBe('測試電影');
  });

  it('不同請求各自快取', async () => {
    await fetchDoubanCategories(params, '');
    await fetchDoubanCategories({ ...params, pageStart: 20 }, '');

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('超過 TTL 後重新請求', async () => {
    jest.useFakeTimers({ now: Date.now() });
    await fetchDoubanCategories(params, '');

    // 前進 31 分鐘（TTL 為 30 分鐘）
    jest.setSystemTime(Date.now() + 31 * 60 * 1000);
    await fetchDoubanCategories(params, '');

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('快取內容損壞時視為未命中並重新請求', async () => {
    await fetchDoubanCategories(params, '');
    // 汙染所有豆瓣快取條目
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('douban-cache:')) {
        sessionStorage.setItem(key, 'not-json');
      }
    }
    await fetchDoubanCategories(params, '');

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
