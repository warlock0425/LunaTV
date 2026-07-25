/**
 * HybridCacheManager 的解析記憶體備份（memo）測試。
 *
 * memo 是為了避免播放期間每 5 秒重複 JSON.parse 整份快取 blob 而加入的，
 * 但它位於資料完整性敏感的路徑上，因此重點驗證：
 * 1) 讀寫結果與沒有 memo 時完全一致；
 * 2) 其他分頁（或任何外部）改寫 localStorage 後 memo 會自動失效；
 * 3) 清除快取後 memo 不會殘留舊資料。
 */

jest.mock('../auth', () => ({
  getAuthInfoFromBrowserCookie: () => ({ username: 'tester' }),
}));

import { cacheManager } from './cache';

const CACHE_KEY = 'moontv_cache_tester';

const record = (index: number) => ({
  'src+1': {
    title: '影片',
    source_name: '來源',
    year: '2026',
    cover: '',
    index,
    total_episodes: 12,
    play_time: 10,
    total_time: 100,
    save_time: 1,
  },
});

describe('HybridCacheManager 快取解析記憶體備份', () => {
  beforeEach(() => {
    localStorage.clear();
    // 透過清除使用者快取讓 memo 一併失效，確保測試互相隔離
    cacheManager.clearUserCache('tester');
  });

  it('寫入後可讀回相同資料', () => {
    cacheManager.cachePlayRecords(record(3));
    expect(cacheManager.getCachedPlayRecords()).toEqual(record(3));
  });

  it('重複讀取回傳一致結果', () => {
    cacheManager.cachePlayRecords(record(3));
    const first = cacheManager.getCachedPlayRecords();
    const second = cacheManager.getCachedPlayRecords();
    expect(first).toEqual(second);
    expect(second).toEqual(record(3));
  });

  it('連續寫入後讀到的是最新值（memo 必須跟著更新）', () => {
    cacheManager.cachePlayRecords(record(1));
    cacheManager.cachePlayRecords(record(2));
    cacheManager.cachePlayRecords(record(3));
    expect(cacheManager.getCachedPlayRecords()).toEqual(record(3));
  });

  it('外部（其他分頁）直接改寫 localStorage 後，memo 會失效並讀到新值', () => {
    cacheManager.cachePlayRecords(record(1));
    expect(cacheManager.getCachedPlayRecords()).toEqual(record(1));

    // 模擬另一個分頁寫入
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) as string);
    raw.playRecords.data = record(9);
    localStorage.setItem(CACHE_KEY, JSON.stringify(raw));

    expect(cacheManager.getCachedPlayRecords()).toEqual(record(9));
  });

  it('外部清空 localStorage 後不會回傳殘留的 memo 資料', () => {
    cacheManager.cachePlayRecords(record(1));
    expect(cacheManager.getCachedPlayRecords()).toEqual(record(1));

    localStorage.removeItem(CACHE_KEY);

    expect(cacheManager.getCachedPlayRecords()).toBeNull();
  });

  it('clearUserCache 後讀不到舊資料', () => {
    cacheManager.cachePlayRecords(record(1));
    cacheManager.clearUserCache('tester');
    expect(cacheManager.getCachedPlayRecords()).toBeNull();
  });

  it('不同資料種類互不干擾', () => {
    cacheManager.cachePlayRecords(record(3));
    cacheManager.cacheSearchHistory(['a', 'b']);
    cacheManager.cacheFavorites({});

    expect(cacheManager.getCachedPlayRecords()).toEqual(record(3));
    expect(cacheManager.getCachedSearchHistory()).toEqual(['a', 'b']);
    expect(cacheManager.getCachedFavorites()).toEqual({});
  });

  it('刪除情境：取出後就地修改再寫回，結果正確', () => {
    cacheManager.cachePlayRecords({
      ...record(3),
      'src+2': record(5)['src+1'],
    });

    // 對應 deletePlayRecord 的實際模式：就地 delete 後立刻寫回
    const cached = cacheManager.getCachedPlayRecords() as Record<
      string,
      unknown
    >;
    delete cached['src+2'];
    cacheManager.cachePlayRecords(
      cached as ReturnType<typeof record> & Record<string, never>
    );

    expect(Object.keys(cacheManager.getCachedPlayRecords() ?? {})).toEqual([
      'src+1',
    ]);
  });
});
