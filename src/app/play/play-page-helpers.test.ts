import type { SearchResult } from '@/lib/types';

import {
  clampEpisodeIndex,
  DETAIL_CACHE_HARD_TTL,
  DETAIL_CACHE_TTL,
  type DetailCacheEntry,
  formatEpisodeBadge,
  formatEpisodeUpdateMessage,
  getEpisodeCount,
  getEpisodeUrl,
  mergeDetailPreservingPlayback,
  mergeFreshDetail,
  pruneOldestDetailCacheEntries,
  resolveCachedDetailEntry,
  resolveEpisodeIndexAfterRefresh,
  shouldApplyBackgroundDetail,
} from './play-page-helpers';

function makeDetail(
  overrides: Partial<SearchResult> &
    Pick<SearchResult, 'episodes'> & { source?: string; id?: string }
): SearchResult {
  return {
    id: overrides.id ?? '1',
    title: overrides.title ?? 'Demo',
    poster: overrides.poster ?? '',
    episodes: overrides.episodes,
    episodes_titles:
      overrides.episodes_titles ??
      overrides.episodes.map((_, i) => `E${i + 1}`),
    source: overrides.source ?? 'srcA',
    source_name: overrides.source_name ?? 'Source A',
    year: overrides.year ?? '2024',
    desc: overrides.desc,
    type_name: overrides.type_name,
    douban_id: overrides.douban_id,
    class: overrides.class,
  };
}

describe('detail cache SWR (resolveCachedDetailEntry)', () => {
  const soft = DETAIL_CACHE_TTL;
  const hard = DETAIL_CACHE_HARD_TTL;
  const base = 1_000_000;
  const entry = (ageMs: number): DetailCacheEntry => ({
    detail: makeDetail({ episodes: ['https://cdn.example/1.m3u8'] }),
    timestamp: base - ageMs,
  });

  it('soft 內 → fresh（stale=false）', () => {
    const r = resolveCachedDetailEntry(entry(soft - 1), base, soft, hard);
    expect(r).toEqual(
      expect.objectContaining({ stale: false, detail: expect.any(Object) })
    );
  });

  it('soft 過期、hard 內 → stale 仍回 detail（不刪）', () => {
    const r = resolveCachedDetailEntry(entry(soft + 1), base, soft, hard);
    expect(r).not.toBe('hard_expired');
    expect(r).not.toBeNull();
    if (r && r !== 'hard_expired') {
      expect(r.stale).toBe(true);
      expect(r.detail.episodes[0]).toBe('https://cdn.example/1.m3u8');
    }
  });

  it('hard 過期 → hard_expired（呼叫端才刪）', () => {
    expect(resolveCachedDetailEntry(entry(hard + 1), base, soft, hard)).toBe(
      'hard_expired'
    );
  });

  it('缺條目 → null', () => {
    expect(resolveCachedDetailEntry(undefined, base, soft, hard)).toBeNull();
  });
});

describe('pruneOldestDetailCacheEntries', () => {
  it('超過上限時保留最新的 maxKeep 筆', () => {
    const cache = {
      a: {
        detail: makeDetail({ id: 'a', episodes: ['a'] }),
        timestamp: 1,
      },
      b: {
        detail: makeDetail({ id: 'b', episodes: ['b'] }),
        timestamp: 3,
      },
      c: {
        detail: makeDetail({ id: 'c', episodes: ['c'] }),
        timestamp: 2,
      },
    };
    const pruned = pruneOldestDetailCacheEntries(cache, 2);
    expect(Object.keys(pruned).sort()).toEqual(['b', 'c']);
    expect(pruned.a).toBeUndefined();
  });
});

describe('shouldApplyBackgroundDetail（背景刷新 URL 雙重保險）', () => {
  const prev = makeDetail({
    episodes: [
      'https://cdn.example/1.m3u8?s=old',
      'https://cdn.example/2.m3u8?s=old',
    ],
  });

  it('當前集 URL 相同 → 可套用', () => {
    const next = makeDetail({
      episodes: [
        'https://cdn.example/1.m3u8?s=old',
        'https://cdn.example/2.m3u8?s=new',
      ],
    });
    expect(shouldApplyBackgroundDetail(prev, next, 0)).toBe(true);
  });

  it('當前集 URL 變了 → 拒絕套用（拿掉這條必紅）', () => {
    const next = makeDetail({
      episodes: [
        'https://cdn.example/1.m3u8?s=ROTATED',
        'https://cdn.example/2.m3u8?s=old',
      ],
    });
    expect(shouldApplyBackgroundDetail(prev, next, 0)).toBe(false);
  });

  it('prev 無 URL 時允許套用（無正在播的位址可護）', () => {
    expect(
      shouldApplyBackgroundDetail(makeDetail({ episodes: [''] }), prev, 0)
    ).toBe(true);
  });

  it('next 無集數 → 拒絕', () => {
    expect(
      shouldApplyBackgroundDetail(prev, makeDetail({ episodes: [] }), 0)
    ).toBe(false);
  });
});

describe('formatEpisodeBadge', () => {
  it('純數字集標題改寫成「第 N 集」', () => {
    expect(formatEpisodeBadge('4', 3)).toBe('第 4 集');
    expect(formatEpisodeBadge('04', 0)).toBe('第 4 集');
  });

  it('已是「第 N 集」格式時正規化空白', () => {
    expect(formatEpisodeBadge('第4集', 0)).toBe('第 4 集');
    expect(formatEpisodeBadge('第 12 集', 11)).toBe('第 12 集');
  });

  it('有意義的集標題保留，缺漏時用索引後備', () => {
    expect(formatEpisodeBadge('終焉的起點', 0)).toBe('終焉的起點');
    expect(formatEpisodeBadge('', 2)).toBe('第 3 集');
    expect(formatEpisodeBadge(null, 0)).toBe('第 1 集');
  });
});

describe('play page detail merge helpers', () => {
  it('counts and clamps episode indexes safely', () => {
    expect(getEpisodeCount(null)).toBe(0);
    expect(getEpisodeCount(makeDetail({ episodes: ['a', 'b', 'c'] }))).toBe(3);
    expect(clampEpisodeIndex(0, 0)).toBe(0);
    expect(clampEpisodeIndex(-1, 5)).toBe(0);
    expect(clampEpisodeIndex(99, 5)).toBe(4);
    expect(clampEpisodeIndex(2.8, 5)).toBe(2);
  });

  it('reads episode urls without throwing on bounds', () => {
    const detail = makeDetail({
      episodes: [
        'https://cdn.example/1.m3u8',
        'https://cdn.example/2.m3u8?sign=1',
      ],
    });
    expect(getEpisodeUrl(detail, 1)).toBe('https://cdn.example/2.m3u8?sign=1');
    expect(getEpisodeUrl(detail, 9)).toBe('');
    expect(getEpisodeUrl(null, 0)).toBe('');
  });

  it('rejects empty fresh details and source mismatches', () => {
    const prev = makeDetail({
      source: 'a',
      id: '1',
      episodes: ['https://cdn.example/1.m3u8'],
    });
    expect(mergeFreshDetail(prev, null, 0).applied).toBe(false);
    expect(
      mergeFreshDetail(
        prev,
        makeDetail({ source: 'b', id: '1', episodes: ['x.m3u8'] }),
        0
      ).reason
    ).toBe('source_mismatch');
    expect(
      mergeFreshDetail(
        prev,
        makeDetail({ source: 'a', id: '2', episodes: ['x.m3u8'] }),
        0
      ).applied
    ).toBe(false);
  });

  it('grows episode lists and clamps when episodes shrink', () => {
    const prev = makeDetail({
      episodes: ['u1', 'u2'],
      episodes_titles: ['1', '2'],
    });
    const grown = mergeFreshDetail(
      prev,
      makeDetail({
        episodes: ['u1b', 'u2b', 'u3'],
        episodes_titles: ['1', '2', '3'],
        year: '2025',
      }),
      1,
      { preserveCurrentEpisodeUrl: true }
    );
    expect(grown.applied).toBe(true);
    expect(grown.episodeCountIncreased).toBe(true);
    expect(grown.nextEpisodeCount).toBe(3);
    expect(grown.detail?.episodes).toEqual(['u1b', 'u2', 'u3']);
    expect(grown.detail?.year).toBe('2025');
    expect(grown.currentEpisodeUrlChanged).toBe(false);

    const shrunk = mergeFreshDetail(
      makeDetail({ episodes: ['a', 'b', 'c'] }),
      makeDetail({ episodes: ['a2'] }),
      2,
      { preserveCurrentEpisodeUrl: false }
    );
    expect(shrunk.episodeIndex).toBe(0);
    expect(shrunk.episodeCountChanged).toBe(true);
    expect(shrunk.episodeCountIncreased).toBe(false);
  });

  it('can force URL refresh on playback error path', () => {
    const prev = makeDetail({
      episodes: ['https://cdn.example/old.m3u8?sign=old'],
    });
    const fresh = makeDetail({
      episodes: ['https://cdn.example/new.m3u8?sign=new'],
    });
    const forced = mergeFreshDetail(prev, fresh, 0, {
      preserveCurrentEpisodeUrl: false,
    });
    expect(forced.detail?.episodes[0]).toContain('sign=new');
    expect(forced.currentEpisodeUrlChanged).toBe(true);
  });

  it('advances from last episode only when growth refresh is requested', () => {
    expect(
      resolveEpisodeIndexAfterRefresh({
        previousIndex: 11,
        previousEpisodeCount: 12,
        nextEpisodeCount: 13,
        clampedIndex: 11,
        preferAdvanceOnGrowth: true,
      })
    ).toBe(12);

    expect(
      resolveEpisodeIndexAfterRefresh({
        previousIndex: 5,
        previousEpisodeCount: 12,
        nextEpisodeCount: 13,
        clampedIndex: 5,
        preferAdvanceOnGrowth: true,
      })
    ).toBe(5);

    expect(
      resolveEpisodeIndexAfterRefresh({
        previousIndex: 11,
        previousEpisodeCount: 12,
        nextEpisodeCount: 12,
        clampedIndex: 11,
        preferAdvanceOnGrowth: true,
      })
    ).toBe(11);
  });

  it('formats update toast copy', () => {
    expect(formatEpisodeUpdateMessage(12, 13)).toBe('已更新至第 13 集');
    expect(formatEpisodeUpdateMessage(12, 12)).toBeNull();
    expect(formatEpisodeUpdateMessage(12, 10)).toBeNull();
  });

  it('preserves playing url and index when background detail grows', () => {
    const prev = makeDetail({
      episodes: ['u1', 'u2-playing'],
      episodes_titles: ['1', '2'],
    });
    const fresh = makeDetail({
      episodes: ['u1b', 'u2-new', 'u3'],
      episodes_titles: ['1', '2', '3'],
    });
    const merged = mergeDetailPreservingPlayback(prev, fresh, 1);
    expect(merged.applied).toBe(true);
    expect(merged.episodeIndex).toBe(1);
    expect(merged.detail?.episodes[1]).toBe('u2-playing');
    expect(merged.detail?.episodes).toHaveLength(3);
    expect(merged.currentEpisodeUrlChanged).toBe(false);
  });

  it('does not shrink episode list during playback when upstream returns fewer', () => {
    const prev = makeDetail({ episodes: ['a', 'b', 'c'] });
    const fresh = makeDetail({ episodes: ['a2'] });
    const merged = mergeDetailPreservingPlayback(prev, fresh, 2);
    expect(merged.applied).toBe(true);
    expect(merged.detail?.episodes).toEqual(['a', 'b', 'c']);
    expect(merged.episodeIndex).toBe(2);
  });
});
