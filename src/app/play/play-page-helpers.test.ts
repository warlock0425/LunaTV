import type { SearchResult } from '@/lib/types';

import {
  applyPlaybackUrlUpdates,
  applyResumeToPlayer,
  clampEpisodeIndex,
  clampResumeTarget,
  DETAIL_CACHE_HARD_TTL,
  DETAIL_CACHE_KEY,
  DETAIL_CACHE_TTL,
  type DetailCacheEntry,
  ensureVideoSource,
  formatEpisodeBadge,
  formatEpisodeUpdateMessage,
  getCachedDetail,
  getEpisodeCount,
  getEpisodeUrl,
  getPlayPageRemountKey,
  getResumeSeekOutcome,
  isResumeDurationReliable,
  mergeDetailPreservingPlayback,
  mergeFreshDetail,
  parsePlayUrlEpisode,
  pruneOldestDetailCacheEntries,
  resolveCachedDetailEntry,
  resolveEpisodeIndexAfterRefresh,
  resolvePlayResume,
  setCachedDetail,
  shouldApplyBackgroundDetail,
  shouldApplyPlayResume,
  shouldSeekLateResume,
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
    episode_count: overrides.episode_count,
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

  it('prev 是探針且集數清單不完整時，即使當前集 URL 變更也強制允許套用', () => {
    const probePrev = makeDetail({
      source: 'guangsu',
      id: '1',
      episode_count: 1184,
      episodes: ['https://cdn.example/probe.m3u8'],
    });
    const fullNext = makeDetail({
      source: 'guangsu',
      id: '1',
      episode_count: 1184,
      episodes: [
        'https://cdn.example/ep1.m3u8',
        'https://cdn.example/ep2.m3u8',
      ],
    });
    expect(shouldApplyBackgroundDetail(probePrev, fullNext, 0)).toBe(true);
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

  it('prev 是未水合探針時直接以 fresh 完整集數覆蓋，不把探針鎖在第 1 集', () => {
    const prev = makeDetail({
      source: 'guangsu',
      id: '1',
      episode_count: 1184,
      episodes: ['https://cdn.example/probe-ep2.m3u8'],
    });
    const fresh = makeDetail({
      source: 'guangsu',
      id: '1',
      episode_count: 1184,
      episodes: [
        'https://cdn.example/real-ep1.m3u8',
        'https://cdn.example/real-ep2.m3u8',
      ],
    });
    const merged = mergeDetailPreservingPlayback(prev, fresh, 0);
    expect(merged.applied).toBe(true);
    expect(merged.detail?.episodes[0]).toBe(
      'https://cdn.example/real-ep1.m3u8'
    );
    expect(merged.detail?.episodes).toHaveLength(2);
  });
});

describe('getCachedDetail / setCachedDetail 探針快取過濾', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('setCachedDetail 不會把未水合探針寫入 localStorage', () => {
    const probe = makeDetail({
      source: 'guangsu',
      id: '1',
      episode_count: 1184,
      episodes: ['https://cdn.example/probe.m3u8'],
    });
    setCachedDetail('guangsu', '1', probe);
    expect(localStorage.getItem(DETAIL_CACHE_KEY)).toBeNull();
  });

  it('getCachedDetail 遇到 localStorage 內已有的未水合探針回傳 null', () => {
    const probe = makeDetail({
      source: 'guangsu',
      id: '1',
      episode_count: 1184,
      episodes: ['https://cdn.example/probe.m3u8'],
    });
    localStorage.setItem(
      DETAIL_CACHE_KEY,
      JSON.stringify({
        guangsu_1: {
          detail: probe,
          timestamp: Date.now(),
        },
      })
    );
    expect(getCachedDetail('guangsu', '1')).toBeNull();
  });
});

describe('play page URL / remount helpers', () => {
  it('builds a remount key that does not collide on underscore titles', () => {
    expect(getPlayPageRemountKey('src', '1', 'a_b')).not.toBe(
      getPlayPageRemountKey('src', '1_a', 'b')
    );
  });

  it('updates playback query params without touching unrelated ones', () => {
    const next = applyPlaybackUrlUpdates(
      'https://tv.example/play?source=a&id=1&keep=yes',
      { episode: 3, title: '新片名', id: '' },
      ['prefer']
    );
    const parsed = new URL(next);
    expect(parsed.searchParams.get('source')).toBe('a');
    expect(parsed.searchParams.get('keep')).toBe('yes');
    expect(parsed.searchParams.get('episode')).toBe('3');
    expect(parsed.searchParams.get('title')).toBe('新片名');
    expect(parsed.searchParams.get('id')).toBeNull();
    expect(parsed.searchParams.get('prefer')).toBeNull();
  });

  it('only late-seeks resume when the player has not started watching', () => {
    expect(shouldSeekLateResume(120, 0)).toBe(true);
    expect(shouldSeekLateResume(120, 2.9)).toBe(true);
    expect(shouldSeekLateResume(120, 3)).toBe(false);
    expect(shouldSeekLateResume(2, 0)).toBe(false);
  });

  it('clamps resume targets that sit on the last seconds of duration', () => {
    expect(clampResumeTarget(95, 100)).toBe(95);
    expect(clampResumeTarget(99, 100)).toBe(95);
    expect(clampResumeTarget(10, 0)).toBe(10);
  });

  it('parses a 1-based episode query and ignores junk', () => {
    expect(parsePlayUrlEpisode('5')).toBe(5);
    expect(parsePlayUrlEpisode('0')).toBeNull();
    expect(parsePlayUrlEpisode('nope')).toBeNull();
    expect(parsePlayUrlEpisode(null)).toBeNull();
  });

  it('prefers the play record over a default episode=1 URL', () => {
    expect(
      resolvePlayResume({
        urlEpisode: 1,
        recordIndex: 5,
        recordPlayTime: 1200,
      })
    ).toEqual({ episodeIndex: 4, resumeTime: 1200 });
    expect(
      resolvePlayResume({
        urlEpisode: null,
        recordIndex: 5,
        recordPlayTime: 1200,
      })
    ).toEqual({ episodeIndex: 4, resumeTime: 1200 });
    expect(
      resolvePlayResume({
        urlEpisode: 5,
        recordIndex: 5,
        recordPlayTime: 1200,
      })
    ).toEqual({ episodeIndex: 4, resumeTime: 1200 });
  });

  it('does not let a later play-record save pull the user back to the previous episode', () => {
    expect(
      shouldApplyPlayResume({
        alreadyApplied: true,
        episodeChanged: true,
        currentTime: 0,
      })
    ).toBe(false);
    expect(
      shouldApplyPlayResume({
        alreadyApplied: true,
        episodeChanged: false,
        currentTime: 1400,
      })
    ).toBe(false);
    expect(
      shouldApplyPlayResume({
        alreadyApplied: false,
        episodeChanged: true,
        currentTime: 0,
      })
    ).toBe(true);
  });

  it('honors an explicit non-default episode in the URL', () => {
    expect(
      resolvePlayResume({
        urlEpisode: 3,
        recordIndex: 5,
        recordPlayTime: 1200,
      })
    ).toEqual({ episodeIndex: 2, resumeTime: 0 });
  });

  it('waits to seek until HLS duration looks like a real VOD length', () => {
    expect(isResumeDurationReliable(0, 1200)).toBe(false);
    expect(isResumeDurationReliable(8, 1200)).toBe(false);
    expect(isResumeDurationReliable(1400, 1200)).toBe(true);
    expect(isResumeDurationReliable(40, 35)).toBe(true);
    expect(getResumeSeekOutcome(1200, 0, 8)).toBe('wait');
    expect(getResumeSeekOutcome(1200, 0, 1400)).toBe('seek');
    expect(getResumeSeekOutcome(1200, 1198, 1400)).toBe('done');
  });

  it('does not clamp a late resume onto a tiny HLS duration', () => {
    const player = { currentTime: 0, duration: 8 };
    expect(applyResumeToPlayer(player, 1200)).toBe('wait');
    expect(player.currentTime).toBe(0);

    player.duration = 1400;
    expect(applyResumeToPlayer(player, 1200)).toBe('seek');
    expect(player.currentTime).toBe(1200);
  });

  it('keeps a single video source element and re-enables remote playback', () => {
    const video = document.createElement('video');
    video.setAttribute('disableRemotePlayback', '');
    const stale = document.createElement('source');
    stale.src = 'https://cdn.example/old.m3u8';
    video.appendChild(stale);

    ensureVideoSource(video, 'https://cdn.example/new.m3u8');
    expect(video.querySelectorAll('source')).toHaveLength(1);
    expect(video.querySelector('source')?.src).toContain('/new.m3u8');
    expect(video.hasAttribute('disableRemotePlayback')).toBe(false);
  });
});
