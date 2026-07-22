import type { SearchResult } from '@/lib/types';

import {
  fetchFreshDetailFromApi,
  planApplyFreshDetail,
  runRefreshEpisodesIfNeeded,
} from './detail-refresh';

function makeDetail(
  overrides: Partial<SearchResult> & Pick<SearchResult, 'episodes'>
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
  };
}

describe('detail-refresh planners', () => {
  it('plans growth with optional advance from last episode', () => {
    const prev = makeDetail({ episodes: ['a', 'b'] });
    const fresh = makeDetail({
      episodes: ['a2', 'b2', 'c'],
      year: '2025',
    });

    const plan = planApplyFreshDetail(prev, fresh, 1, 'Hint', {
      preferAdvanceOnGrowth: true,
      notifyOnGrowth: true,
      preserveCurrentEpisodeUrl: true,
    });

    expect(plan.applied).toBe(true);
    if (!plan.applied) return;
    expect(plan.episodeCountIncreased).toBe(true);
    expect(plan.nextEpisodeCount).toBe(3);
    // index 1 was last -> advance to 2
    expect(plan.episodeIndex).toBe(2);
    expect(plan.shouldUpdateIndex).toBe(true);
    expect(plan.growthMessage).toBe('已更新至第 3 集');
    expect(plan.detail.episodes[1]).toBe('b'); // preserved current url
    expect(plan.stableTitle).toBe('Demo');
  });

  it('does not advance when not on last episode', () => {
    const prev = makeDetail({ episodes: ['a', 'b', 'c'] });
    const fresh = makeDetail({ episodes: ['a', 'b', 'c', 'd'] });
    const plan = planApplyFreshDetail(prev, fresh, 0, undefined, {
      preferAdvanceOnGrowth: true,
      notifyOnGrowth: false,
    });
    expect(plan.applied).toBe(true);
    if (!plan.applied) return;
    expect(plan.episodeIndex).toBe(0);
    expect(plan.growthMessage).toBeNull();
  });
});

describe('fetchFreshDetailFromApi', () => {
  it('returns null on non-ok response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false });
    await expect(
      fetchFreshDetailFromApi('s', '1', fetchImpl as unknown as typeof fetch)
    ).resolves.toBeNull();
  });

  it('returns detail when episodes exist', async () => {
    const detail = makeDetail({ episodes: ['u1'] });
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => detail,
    });
    await expect(
      fetchFreshDetailFromApi('s', '1', fetchImpl as unknown as typeof fetch)
    ).resolves.toEqual(detail);
  });
});

describe('runRefreshEpisodesIfNeeded', () => {
  it('notifies unchanged when already latest', async () => {
    const notify = jest.fn();
    const apply = jest.fn().mockReturnValue({
      applied: true,
      episodeCountIncreased: false,
      nextEpisodeCount: 2,
      episodeIndex: 1,
    });
    const result = await runRefreshEpisodesIfNeeded({
      source: 's',
      id: '1',
      currentSource: 's',
      currentId: '1',
      currentIndex: 1,
      currentEpisodeCount: 2,
      inFlight: false,
      setInFlight: jest.fn(),
      notifyWhenUnchanged: true,
      fetchFreshDetail: async () => makeDetail({ episodes: ['a', 'b'] }),
      apply,
      notify,
    });
    expect(result.updated).toBe(false);
    expect(notify).toHaveBeenCalledWith('目前仍是最新一集', 'info');
  });

  it('reports advanced when apply moves index after growth', async () => {
    const notify = jest.fn();
    const apply = jest.fn().mockReturnValue({
      applied: true,
      episodeCountIncreased: true,
      nextEpisodeCount: 3,
      episodeIndex: 2,
    });
    const result = await runRefreshEpisodesIfNeeded({
      source: 's',
      id: '1',
      currentSource: 's',
      currentId: '1',
      currentIndex: 1,
      currentEpisodeCount: 2,
      inFlight: false,
      setInFlight: jest.fn(),
      preferAdvanceOnGrowth: true,
      notifyWhenUnchanged: false,
      fetchFreshDetail: async () => makeDetail({ episodes: ['a', 'b', 'c'] }),
      apply,
      notify,
    });
    expect(result).toEqual({
      updated: true,
      advanced: true,
      nextEpisodeCount: 3,
    });
  });
});
