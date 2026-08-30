import { createLinkedAbortController, mapWithConcurrency } from './concurrency';
import type { ApiSite } from './config';
import { searchFromApi } from './downstream';
import { hydrateSearchCacheForQuery } from './search-cache';
import {
  getSearchDeadlineMs,
  getSearchSourceConcurrency,
  getSearchSuccessSourceCutoff,
} from './search-runtime';
import { hydrateBreakersFromStore } from './source-circuit-breaker';
import { recordSourceSearch } from './source-health';
import type { SearchResult } from './types';

export type SearchFanoutSiteResult = {
  site: ApiSite;
  results: SearchResult[];
  timedOut: boolean;
  durationMs: number;
  error?: unknown;
  skipped?: boolean;
};

export async function fanoutSearchSources(options: {
  sites: ApiSite[];
  query: string;
  variants: string[];
  parentSignal?: AbortSignal;
  onSiteResult?: (result: SearchFanoutSiteResult) => void;
}): Promise<SearchFanoutSiteResult[]> {
  const { sites, query, variants, parentSignal, onSiteResult } = options;
  if (sites.length === 0) return [];

  await Promise.all([
    hydrateBreakersFromStore(),
    hydrateSearchCacheForQuery(
      query,
      sites.map((site) => site.key)
    ),
  ]);

  const concurrency = getSearchSourceConcurrency();
  const cutoff = getSearchSuccessSourceCutoff();
  const deadlineMs = getSearchDeadlineMs();
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }
  const deadlineTimer = setTimeout(() => controller.abort(), deadlineMs);

  let successSources = 0;

  try {
    return await mapWithConcurrency(
      sites,
      concurrency,
      async (site) => {
        if (controller.signal.aborted) {
          return {
            site,
            results: [],
            timedOut: false,
            durationMs: 0,
            skipped: true,
          };
        }

        const startedAt = Date.now();
        const linked = createLinkedAbortController(
          controller.signal,
          deadlineMs
        );
        try {
          const results = await searchFromApi(
            site,
            query,
            variants,
            linked.controller.signal
          );
          const timedOut =
            linked.controller.signal.aborted && !controller.signal.aborted;
          recordSourceSearch(site.key, Date.now() - startedAt, timedOut);

          if (results.length > 0) {
            successSources += 1;
            if (successSources >= cutoff) controller.abort();
          }

          const payload: SearchFanoutSiteResult = {
            site,
            results,
            timedOut,
            durationMs: Date.now() - startedAt,
          };
          onSiteResult?.(payload);
          return payload;
        } catch (error) {
          recordSourceSearch(site.key, Date.now() - startedAt, true);
          const payload: SearchFanoutSiteResult = {
            site,
            results: [],
            timedOut: true,
            durationMs: Date.now() - startedAt,
            error,
          };
          onSiteResult?.(payload);
          return payload;
        } finally {
          linked.cleanup();
        }
      },
      {
        signal: controller.signal,
        skipped: (site) => ({
          site,
          results: [],
          timedOut: false,
          durationMs: 0,
          skipped: true,
        }),
      }
    );
  } finally {
    clearTimeout(deadlineTimer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}
