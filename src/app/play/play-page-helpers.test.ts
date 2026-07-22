import type { SearchResult } from '@/lib/types';

import {
  clampEpisodeIndex,
  formatEpisodeUpdateMessage,
  getEpisodeCount,
  getEpisodeUrl,
  mergeDetailPreservingPlayback,
  mergeFreshDetail,
  resolveEpisodeIndexAfterRefresh,
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
