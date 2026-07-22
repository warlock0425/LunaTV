import type { ApiSite } from './config';

jest.mock('./config', () => ({
  API_CONFIG: {
    search: {
      path: '?ac=videolist&wd=',
      headers: { Accept: 'application/json' },
    },
    detail: {
      path: '?ac=videolist&ids=',
      headers: { Accept: 'application/json' },
    },
  },
}));

jest.mock('./downstream', () => ({
  getDetailFromApi: jest.fn(),
}));

jest.mock('./url-safety', () => ({
  fetchSafeRemoteUrl: jest.fn(),
  isSafeRemoteUrl: jest.fn(() => true),
  readResponseJsonWithLimit: jest.fn(),
  readResponseTextWithLimit: jest.fn(),
}));

import { getDetailFromApi } from './downstream';
import {
  clearValidationResult,
  getLastValidationResults,
  getSourceDisableSuggestion,
  isM3u8Link,
  orderSourcesByValidation,
  parseEpisodesFromVodPlayUrl,
  rememberValidationResult,
  validateSourceSite,
} from './source-validation';
import {
  fetchSafeRemoteUrl,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from './url-safety';

const mockedFetch = jest.mocked(fetchSafeRemoteUrl);
const mockedJson = jest.mocked(readResponseJsonWithLimit);
const mockedText = jest.mocked(readResponseTextWithLimit);
const mockedDetail = jest.mocked(getDetailFromApi);

const site = {
  key: 'demo',
  name: 'Demo',
  api: 'https://demo.example/api.php/provide/vod',
  disabled: false,
  from: 'config',
} as ApiSite;

describe('source-validation helpers', () => {
  beforeEach(() => {
    clearValidationResult();
    jest.clearAllMocks();
  });

  it('detects m3u8 links with signed query strings', () => {
    expect(isM3u8Link('https://cdn.example/a/index.m3u8')).toBe(true);
    expect(isM3u8Link('https://cdn.example/a/index.m3u8?sign=abc')).toBe(true);
    expect(isM3u8Link('https://cdn.example/a/index.mp4')).toBe(false);
  });

  it('parses vod_play_url groups and prefers the longest episode list', () => {
    const episodes = parseEpisodesFromVodPlayUrl(
      [
        '第1集$https://cdn.example/1.m3u8#第2集$https://cdn.example/2.m3u8',
        '线路B$https://cdn.example/b1.m3u8',
      ].join('$$$')
    );
    expect(episodes).toEqual([
      'https://cdn.example/1.m3u8',
      'https://cdn.example/2.m3u8',
    ]);
  });

  it('marks no_results when search list is empty', async () => {
    mockedFetch.mockResolvedValue({ ok: true } as Response);
    mockedJson.mockResolvedValue({ list: [] });

    const result = await validateSourceSite(site, {
      keyword: '測試',
      probePlayback: false,
    });

    expect(result.status).toBe('no_results');
    expect(result.levels.search).toBe('pass');
    expect(getLastValidationResults()[0]?.source).toBe('demo');
  });

  it('returns valid when search/detail/playable all pass', async () => {
    mockedFetch.mockResolvedValue({ ok: true } as Response);
    mockedJson.mockResolvedValue({
      list: [
        {
          vod_id: '9',
          vod_name: '測試劇集',
          vod_play_url: '1$https://cdn.example/1.m3u8?sign=1',
        },
      ],
    });
    mockedText.mockResolvedValue('#EXTM3U\n#EXTINF:1,\nseg.ts\n');

    const result = await validateSourceSite(site, {
      keyword: '測試',
      probePlayback: true,
    });

    expect(result.status).toBe('valid');
    expect(result.levels).toEqual({
      search: 'pass',
      detail: 'pass',
      playable: 'pass',
    });
    expect(result.episodeCount).toBe(1);
    expect(mockedDetail).not.toHaveBeenCalled();
  });

  it('falls back to detail API when search payload has no play urls', async () => {
    mockedFetch.mockResolvedValue({ ok: true } as Response);
    mockedJson.mockResolvedValue({
      list: [{ vod_id: '42', vod_name: '測試劇集' }],
    });
    mockedDetail.mockResolvedValue({
      id: '42',
      title: '測試劇集',
      poster: '',
      episodes: ['https://cdn.example/x.m3u8'],
      episodes_titles: ['1'],
      source: 'demo',
      source_name: 'Demo',
      year: '2024',
    });
    mockedText.mockResolvedValue('#EXTM3U\n');

    const result = await validateSourceSite(site, {
      keyword: '測試',
      probePlayback: true,
    });

    expect(mockedDetail).toHaveBeenCalled();
    expect(result.status).toBe('valid');
    expect(result.episodeCount).toBe(1);
  });
});

describe('validation ordering and suggestions', () => {
  beforeEach(() => {
    clearValidationResult();
  });

  it('orders valid sources ahead of invalid without dropping unknowns', () => {
    rememberValidationResult({
      source: 'bad',
      status: 'invalid',
      levels: { search: 'fail', detail: 'skip', playable: 'skip' },
      message: 'x',
      resultCount: 0,
      episodeCount: 0,
      latencyMs: 1,
      checkedAt: Date.now(),
    });
    rememberValidationResult({
      source: 'good',
      status: 'valid',
      levels: { search: 'pass', detail: 'pass', playable: 'pass' },
      message: 'ok',
      resultCount: 1,
      episodeCount: 2,
      latencyMs: 1,
      checkedAt: Date.now(),
    });
    const ordered = orderSourcesByValidation([
      { key: 'unknown' },
      { key: 'bad' },
      { key: 'good' },
    ]);
    expect(ordered.map((s) => s.key)).toEqual(['good', 'unknown', 'bad']);
  });

  it('suggests manual disable only for failed validation', () => {
    rememberValidationResult({
      source: 'bad',
      status: 'invalid',
      levels: { search: 'fail', detail: 'skip', playable: 'skip' },
      message: 'x',
      resultCount: 0,
      episodeCount: 0,
      latencyMs: 1,
      checkedAt: Date.now(),
    });
    expect(getSourceDisableSuggestion('bad')?.suggest).toBe(true);
    expect(getSourceDisableSuggestion('missing')).toBeNull();
  });
});
