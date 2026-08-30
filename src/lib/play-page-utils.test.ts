import {
  calculateSourceScore,
  EPISODE_DESCENDING_STORAGE_KEY,
  filterSourcesPreferHighQuality,
  filterTitleSafeCandidates,
  formatPlayerTime,
  getDisplayedSourceEpisodeCount,
  getEpisodeSelectorCounts,
  getLiveHlsBufferConfig,
  getLoadedEpisodeCount,
  getResultEpisodeCount,
  getStableTitle,
  getVodHlsBufferConfig,
  hydrateSearchResultEpisodes,
  hydrateSearchResultEpisodesWithRetry,
  isBelowPreferredDisplayQuality,
  isMobileUserAgent,
  isPreferredDisplayQuality,
  needsEpisodeHydration,
  parseLoadSpeedKBps,
  pickFirstPlayableEpisodeUrl,
  pickNextPreferredSource,
  pickRecommendedSourceKey,
  pickSourceVersionTag,
  pickSpeedTestEpisodeUrl,
  readEpisodeDescendingPreference,
  resolveLoadedEpisodeIndex,
  selectSourceAfterSpeedTests,
  writeEpisodeDescendingPreference,
} from './play-page-utils';

describe('mobile HLS buffers', () => {
  it('detects mobile user agents', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(
      true
    );
    expect(isMobileUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(
      false
    );
  });

  it('uses a smaller VOD buffer on mobile', () => {
    expect(getVodHlsBufferConfig(true).maxBufferLength).toBeLessThan(
      getVodHlsBufferConfig(false).maxBufferLength
    );
    expect(getLiveHlsBufferConfig(true).maxBufferSize).toBeLessThan(
      getLiveHlsBufferConfig(false).maxBufferSize
    );
  });
});

describe('getResultEpisodeCount', () => {
  it('prefers stored episode_count when play URLs were stripped', () => {
    expect(
      getResultEpisodeCount({
        episodes: [],
        episode_count: 24,
      })
    ).toBe(24);
    expect(getResultEpisodeCount({ episodes: ['a', 'b'] })).toBe(2);
    expect(getResultEpisodeCount({ episodes: [] })).toBe(0);
  });
});

describe('getEpisodeSelectorCounts / resolveLoadedEpisodeIndex', () => {
  it('does not treat remarks count as clickable slots when only a probe exists', () => {
    expect(
      getLoadedEpisodeCount({ episodes: ['https://cdn.example/1.m3u8'] })
    ).toBe(1);
    expect(
      getEpisodeSelectorCounts({
        episodes: ['https://cdn.example/probe.m3u8'],
        episode_count: 20,
      })
    ).toEqual({
      loaded: 1,
      advertised: 20,
      showEpisodeTab: false,
    });
  });

  it('uses fallback loaded count from the playing detail', () => {
    expect(
      getEpisodeSelectorCounts(
        { episodes: ['https://a'], episode_count: 20 },
        12
      )
    ).toMatchObject({ loaded: 12, advertised: 20, showEpisodeTab: true });
  });

  it('displays loaded count instead of the remarks 1184 when only a probe exists', () => {
    expect(
      getDisplayedSourceEpisodeCount({
        episodes: ['https://cdn.example/probe.m3u8'],
        episode_count: 1184,
      })
    ).toBe(1);
    expect(
      getDisplayedSourceEpisodeCount({
        episodes: [],
        episode_count: 24,
      })
    ).toBe(24);
    expect(getDisplayedSourceEpisodeCount(null)).toBe(0);
  });

  it('clamps an out-of-range click onto the last loaded episode', () => {
    expect(resolveLoadedEpisodeIndex(15, 1)).toEqual({
      index: 0,
      empty: false,
      clamped: true,
    });
    expect(resolveLoadedEpisodeIndex(5, 20)).toEqual({
      index: 5,
      empty: false,
      clamped: false,
    });
    expect(resolveLoadedEpisodeIndex(3, 0)).toEqual({
      index: 0,
      empty: true,
      clamped: false,
    });
  });
});

describe('pickSourceVersionTag', () => {
  it('returns null when the source title is the main title', () => {
    expect(pickSourceVersionTag('海賊王', '海賊王')).toBeNull();
    expect(pickSourceVersionTag('', '海賊王')).toBeNull();
  });

  it('picks parenthetical version tags and season markers', () => {
    expect(pickSourceVersionTag('海賊王(國語)', '海賊王')).toBe('(國語)');
    expect(pickSourceVersionTag('某劇 第2季', '某劇')).toBe('第2季');
  });
});

describe('episode descending preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to ascending and round-trips through localStorage', () => {
    expect(readEpisodeDescendingPreference()).toBe(false);
    writeEpisodeDescendingPreference(true);
    expect(window.localStorage.getItem(EPISODE_DESCENDING_STORAGE_KEY)).toBe(
      'true'
    );
    expect(readEpisodeDescendingPreference()).toBe(true);
    writeEpisodeDescendingPreference(false);
    expect(readEpisodeDescendingPreference()).toBe(false);
  });
});

describe('needsEpisodeHydration', () => {
  it('needs detail when cache only kept a probe for a multi-episode show', () => {
    expect(
      needsEpisodeHydration({
        source: 'src',
        id: '1',
        episodes: ['https://cdn.example/probe.m3u8'],
        episode_count: 20,
      })
    ).toBe(true);
  });

  it('does not hydrate a complete list or a single-episode title', () => {
    expect(
      needsEpisodeHydration({
        source: 'src',
        id: '1',
        episodes: ['https://a', 'https://b'],
        episode_count: 2,
      })
    ).toBe(false);
    expect(
      needsEpisodeHydration({
        source: 'src',
        id: '1',
        episodes: ['https://movie'],
        episode_count: 1,
      })
    ).toBe(false);
  });
});

describe('hydrateSearchResultEpisodes', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps sources that already have a playable URL', async () => {
    const source = {
      id: '1',
      title: 'A',
      poster: '',
      episodes: ['https://cdn.example/1.m3u8', 'https://cdn.example/2.m3u8'],
      episodes_titles: ['1', '2'],
      source: 'src',
      source_name: '源',
      year: '2024',
    };
    await expect(hydrateSearchResultEpisodes(source)).resolves.toBe(source);
  });

  it('does not refetch when only the first episode URL is playable', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const source = {
      id: '1',
      title: 'A',
      poster: '',
      episodes: ['https://cdn.example/1.m3u8', ''],
      episodes_titles: ['1', '2'],
      source: 'src',
      source_name: '源',
      year: '2024',
    };
    await expect(hydrateSearchResultEpisodes(source)).resolves.toBe(source);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hydrates when cache only kept one probe URL for a series', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        episodes: [
          'https://cdn.example/d1.m3u8',
          'https://cdn.example/d2.m3u8',
          'https://cdn.example/d3.m3u8',
        ],
        episodes_titles: ['1', '2', '3'],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const source = {
      id: '9',
      title: 'A',
      poster: '',
      episodes: ['https://cdn.example/probe.m3u8'],
      episodes_titles: [],
      episode_count: 20,
      source: 'src',
      source_name: '源',
      year: '2024',
    };
    expect(needsEpisodeHydration(source)).toBe(true);
    const hydrated = await hydrateSearchResultEpisodes(source);
    expect(hydrated.episodes).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('fills episodes from /api/detail when search returned none', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        episodes: [
          'https://cdn.example/d1.m3u8',
          'https://cdn.example/d2.m3u8',
        ],
        episodes_titles: ['1', '2'],
        poster: 'https://cdn.example/p.jpg',
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const source = {
      id: '9',
      title: 'A',
      poster: '',
      episodes: [],
      episodes_titles: [],
      source: 'src',
      source_name: '源',
      year: '2024',
    };
    const hydrated = await hydrateSearchResultEpisodes(source);
    expect(hydrated.episodes).toHaveLength(2);
    expect(hydrated.episode_count).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/detail?source=src&id=9',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('forces hydration even when needsEpisodeHydration would be false', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        episodes: [
          'https://cdn.example/d1.m3u8',
          'https://cdn.example/d2.m3u8',
          'https://cdn.example/d3.m3u8',
        ],
        episodes_titles: ['1', '2', '3'],
      }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const source = {
      id: '1',
      title: 'A',
      poster: '',
      episodes: ['https://cdn.example/1.m3u8'],
      episodes_titles: ['1'],
      episode_count: 1,
      source: 'src',
      source_name: '源',
      year: '2024',
    };
    expect(needsEpisodeHydration(source)).toBe(false);
    const hydrated = await hydrateSearchResultEpisodes(source, undefined, {
      force: true,
    });
    expect(hydrated.episodes).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/detail?source=src&id=1',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('retries detail when the first attempt still has only a probe', async () => {
    jest.useFakeTimers();
    let calls = 0;
    const fetchMock = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({
          episodes: [
            'https://cdn.example/d1.m3u8',
            'https://cdn.example/d2.m3u8',
            'https://cdn.example/d3.m3u8',
          ],
        }),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const source = {
      id: '1',
      title: 'A',
      poster: '',
      episodes: ['https://cdn.example/probe.m3u8'],
      episodes_titles: ['1'],
      episode_count: 1184,
      source: 'src',
      source_name: '源',
      year: '2024',
    };
    const pending = hydrateSearchResultEpisodesWithRetry(source, undefined, {
      force: true,
      attempts: 3,
    });
    await jest.runAllTimersAsync();
    const hydrated = await pending;
    expect(hydrated.episodes).toHaveLength(3);
    expect(calls).toBe(2);
    jest.useRealTimers();
  });
});

describe('pickSpeedTestEpisodeUrl（測速取集）', () => {
  it('多集時用第二集，避開 CMS 常塞在 [0] 的預告／花絮', () => {
    expect(
      pickSpeedTestEpisodeUrl([
        'http://cdn/trailer.m3u8',
        'http://cdn/ep2.m3u8',
        'http://cdn/ep3.m3u8',
      ])
    ).toBe('http://cdn/ep2.m3u8');
  });

  it('單集退回 [0]', () => {
    expect(pickSpeedTestEpisodeUrl(['http://cdn/movie.m3u8'])).toBe(
      'http://cdn/movie.m3u8'
    );
  });

  it('空列表或無效輸入回 null', () => {
    expect(pickSpeedTestEpisodeUrl([])).toBeNull();
    expect(pickSpeedTestEpisodeUrl(null)).toBeNull();
    expect(pickSpeedTestEpisodeUrl(undefined)).toBeNull();
    expect(pickSpeedTestEpisodeUrl(['', '  '])).toBeNull();
  });

  it('第二集空白時退回第一個可播網址（否則整源測不到）', () => {
    expect(pickSpeedTestEpisodeUrl(['http://a.m3u8', '  '])).toBe(
      'http://a.m3u8'
    );
    expect(pickSpeedTestEpisodeUrl(['', '  ', 'http://c.m3u8'])).toBe(
      'http://c.m3u8'
    );
  });

  it('有正在播放的集數時優先測那一集', () => {
    expect(
      pickSpeedTestEpisodeUrl(
        ['http://cdn/ep1.m3u8', 'http://cdn/ep2.m3u8', 'http://cdn/ep3.m3u8'],
        2
      )
    ).toBe('http://cdn/ep3.m3u8');
    expect(
      pickSpeedTestEpisodeUrl(['http://cdn/ep1.m3u8', 'http://cdn/ep2.m3u8'], 9)
    ).toBe('http://cdn/ep2.m3u8');
  });
});

describe('pickFirstPlayableEpisodeUrl（換源可播）', () => {
  it('uses the first non-empty URL even if the speed-test slot is blank', () => {
    expect(pickFirstPlayableEpisodeUrl(['http://a.m3u8', '  '])).toBe(
      'http://a.m3u8'
    );
    expect(
      pickFirstPlayableEpisodeUrl(['', 'http://b.m3u8', 'http://c.m3u8'])
    ).toBe('http://b.m3u8');
  });

  it('returns null when no episode has a URL', () => {
    expect(pickFirstPlayableEpisodeUrl([])).toBeNull();
    expect(pickFirstPlayableEpisodeUrl(['', '  '])).toBeNull();
    expect(pickFirstPlayableEpisodeUrl(undefined)).toBeNull();
  });
});

describe('畫質優先過濾（換源列表）', () => {
  it('自動換源先挑下一個 1080p+', () => {
    const sources = [
      { source: 'cur', id: '1' },
      { source: 'low', id: '2' },
      { source: 'hd', id: '3' },
    ];
    const info: Record<string, { quality: string; hasError?: boolean }> = {
      'cur-1': { quality: '720p' },
      'low-2': { quality: '480p' },
      'hd-3': { quality: '1080p' },
    };
    expect(
      pickNextPreferredSource(sources, {
        currentSource: 'cur',
        currentId: '1',
        getInfo: (k) => info[k],
      })
    ).toEqual({ source: 'hd', id: '3' });
  });

  it('識別 1080p+ 與低畫質', () => {
    expect(isPreferredDisplayQuality('1080p')).toBe(true);
    expect(isPreferredDisplayQuality('4K')).toBe(true);
    expect(isPreferredDisplayQuality('720p')).toBe(false);
    expect(isBelowPreferredDisplayQuality('720p')).toBe(true);
    expect(isBelowPreferredDisplayQuality('480p')).toBe(true);
    expect(isBelowPreferredDisplayQuality('未知')).toBe(false);
  });

  it('有 1080p 時隱藏 720p／480p，保留當前、失敗與未測速', () => {
    const sources = [
      { source: 'a', id: '1' }, // 1080
      { source: 'b', id: '2' }, // 720
      { source: 'c', id: '3' }, // 480
      { source: 'd', id: '4' }, // error
      { source: 'e', id: '5' }, // pending
      { source: 'f', id: '6' }, // current 720 — 仍應保留
    ];
    const info: Record<string, { quality: string; hasError?: boolean }> = {
      'a-1': { quality: '1080p' },
      'b-2': { quality: '720p' },
      'c-3': { quality: '480p' },
      'd-4': { quality: '錯誤', hasError: true },
      'f-6': { quality: '720p' },
    };
    const result = filterSourcesPreferHighQuality(sources, {
      currentSource: 'f',
      currentId: '6',
      getInfo: (k) => info[k],
    });
    expect(result.map((s) => `${s.source}-${s.id}`)).toEqual([
      'a-1',
      'd-4',
      'e-5',
      'f-6',
    ]);
  });

  it('推薦只給測過成功的源，空白源不能搶推薦', () => {
    const sources = [
      { source: 'ffzy', id: '88' },
      { source: 'yz', id: '1' },
      { source: 'lz', id: '2' },
    ];
    const info: Record<string, { quality: string; hasError?: boolean }> = {
      'ffzy-88': { quality: '1080p' },
    };
    expect(
      pickRecommendedSourceKey(sources, {
        currentSource: 'ffzy',
        currentId: '88',
        getInfo: (k) => info[k],
      })
    ).toBeNull();

    info['lz-2'] = { quality: '720p' };
    info['yz-1'] = { quality: '1080p' };
    expect(
      pickRecommendedSourceKey(sources, {
        currentSource: 'ffzy',
        currentId: '88',
        getInfo: (k) => info[k],
      })
    ).toBe('yz-1');
  });

  it('沒有 1080p+ 時不掛推薦，即使 480p 已經測完', () => {
    const sources = [
      { source: 'jy', id: '1' },
      { source: 'lz', id: '2' },
      { source: 'ikun', id: '3' },
    ];
    const info: Record<string, { quality: string } | undefined> = {
      'lz-2': { quality: '480p' },
      'ikun-3': { quality: '720p' },
    };
    expect(
      pickRecommendedSourceKey(sources, {
        currentSource: 'jy',
        currentId: '1',
        getInfo: (k) => info[k],
      })
    ).toBeNull();
  });

  it('已有 1080p 時即使別的源還沒測完也推薦高畫質', () => {
    const sources = [
      { source: 'jy', id: '1' },
      { source: 'tt', id: '2' },
      { source: 'ikun', id: '3' },
    ];
    expect(
      pickRecommendedSourceKey(sources, {
        currentSource: 'jy',
        currentId: '1',
        getInfo: (k) => (k === 'tt-2' ? { quality: '1080p' } : undefined),
      })
    ).toBe('tt-2');
  });

  it('尚未測速時不過濾，繼續觀看的源與其他源都會留下', () => {
    const sources = [
      { source: 'ffzy', id: '88' },
      { source: 'lz', id: '1' },
      { source: 'ikun', id: '2' },
    ];
    const result = filterSourcesPreferHighQuality(sources, {
      currentSource: 'ffzy',
      currentId: '88',
      getInfo: () => undefined,
    });
    expect(result.map((s) => `${s.source}-${s.id}`)).toEqual([
      'ffzy-88',
      'lz-1',
      'ikun-2',
    ]);
  });

  it('完全沒有 1080p+ 時不過濾', () => {
    const sources = [
      { source: 'a', id: '1' },
      { source: 'b', id: '2' },
    ];
    const info = {
      'a-1': { quality: '720p' },
      'b-2': { quality: '480p' },
    };
    const result = filterSourcesPreferHighQuality(sources, {
      getInfo: (k) => info[k as keyof typeof info],
    });
    expect(result).toHaveLength(2);
  });
});

describe('play page pure helpers', () => {
  it('picks the first usable stable title', () => {
    expect(getStableTitle(undefined, ' ', 'undefined', 'My Anime')).toBe(
      'My Anime'
    );
    expect(getStableTitle(' null ', 'Fallback')).toBe('Fallback');
    expect(getStableTitle('影片標題', 'Real Title')).toBe('Real Title');
  });

  it('formats player time using the current play page behavior', () => {
    expect(formatPlayerTime(0)).toBe('00:00');
    expect(formatPlayerTime(65)).toBe('01:05');
    expect(formatPlayerTime(3661)).toBe('01:01:01');
  });

  it('parses speed labels to KB/s', () => {
    expect(parseLoadSpeedKBps('800 KB/s')).toBe(800);
    expect(parseLoadSpeedKBps('2.5 MB/s')).toBe(2560);
    expect(parseLoadSpeedKBps('未知')).toBe(0);
    expect(parseLoadSpeedKBps('測量中...')).toBe(0);
    expect(parseLoadSpeedKBps('invalid')).toBe(0);
  });

  it('keeps the original fallback score for unknown speed labels', () => {
    expect(
      calculateSourceScore(
        { quality: '720p', loadSpeed: '未知', pingTime: 100 },
        1024,
        50,
        1000
      )
    ).toBe(53);
    expect(
      calculateSourceScore(
        { quality: '720p', loadSpeed: '測量中...', pingTime: 100 },
        1024,
        50,
        1000
      )
    ).toBe(53);
  });

  it('keeps high-quality fast sources ahead in source scoring', () => {
    const fast1080 = calculateSourceScore(
      { quality: '1080p', loadSpeed: '2 MB/s', pingTime: 80 },
      2048,
      80,
      200
    );
    const slow480 = calculateSourceScore(
      { quality: '480p', loadSpeed: '200 KB/s', pingTime: 300 },
      2048,
      80,
      300
    );

    expect(fast1080).toBeGreaterThan(slow480);
    expect(fast1080).toBe(135);
  });
});

describe('首播畫質底線（selectSourceAfterSpeedTests）', () => {
  const src = (id: string) =>
    ({
      source: id,
      id,
      title: '正確片名',
      episodes: ['http://x'],
    }) as const;

  it('有 1080p 時絕不先選快的 720p', () => {
    const picked = selectSourceAfterSpeedTests([
      {
        source: src('slow-hd'),
        titleScore: 1000,
        testResult: {
          quality: '1080p',
          loadSpeed: '300 KB/s',
          pingTime: 200,
        },
      },
      {
        source: src('fast-720'),
        titleScore: 1000,
        testResult: {
          quality: '720p',
          loadSpeed: '5 MB/s',
          pingTime: 30,
        },
      },
    ]);
    expect(picked).not.toBeNull();
    expect(picked!.fellBackWithoutHd).toBe(false);
    expect(picked!.source.source).toBe('slow-hd');
  });

  it('標題安全組優先於畫質：錯片名 1080p 不得贏過對片名 720p', () => {
    const picked = selectSourceAfterSpeedTests([
      {
        source: { ...src('wrong-hd'), title: '完全不同的片' },
        titleScore: 100,
        testResult: {
          quality: '1080p',
          loadSpeed: '5 MB/s',
          pingTime: 30,
        },
      },
      {
        source: src('right-720'),
        titleScore: 1000,
        testResult: {
          quality: '720p',
          loadSpeed: '200 KB/s',
          pingTime: 200,
        },
      },
    ]);
    expect(picked).not.toBeNull();
    // 標題組只有 right-720；無 1080p+ → 退回
    expect(picked!.source.source).toBe('right-720');
    expect(picked!.fellBackWithoutHd).toBe(true);
  });

  it('完全無 1080p+ 時退回評分並標記 fellBackWithoutHd', () => {
    const picked = selectSourceAfterSpeedTests([
      {
        source: src('a'),
        titleScore: 900,
        testResult: {
          quality: '720p',
          loadSpeed: '1 MB/s',
          pingTime: 80,
        },
      },
      {
        source: src('b'),
        titleScore: 900,
        testResult: {
          quality: '480p',
          loadSpeed: '2 MB/s',
          pingTime: 50,
        },
      },
    ]);
    expect(picked).not.toBeNull();
    expect(picked!.fellBackWithoutHd).toBe(true);
  });

  it('未知畫質不算 1080p+，不單獨觸發高畫質組', () => {
    const picked = selectSourceAfterSpeedTests([
      {
        source: src('unknown'),
        titleScore: 1000,
        testResult: {
          quality: '未知',
          loadSpeed: '2 MB/s',
          pingTime: 40,
        },
      },
      {
        source: src('720'),
        titleScore: 1000,
        testResult: {
          quality: '720p',
          loadSpeed: '500 KB/s',
          pingTime: 100,
        },
      },
    ]);
    expect(picked).not.toBeNull();
    expect(picked!.fellBackWithoutHd).toBe(true);
  });

  it('filterTitleSafeCandidates 距最高分超過 margin 會剔除', () => {
    const safe = filterTitleSafeCandidates([
      { titleScore: 1000, id: 'a' },
      { titleScore: 950, id: 'b' },
      { titleScore: 100, id: 'c' },
    ]);
    expect(safe.map((x) => x.id)).toEqual(['a', 'b']);
  });
});
