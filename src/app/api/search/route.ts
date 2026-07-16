/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { isValidApiSearchQuery } from '@/lib/api-input-validation';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { cleanQueryForApi } from '@/lib/chinese';
import {
  createLinkedAbortController,
  mapWithConcurrency,
} from '@/lib/concurrency';
import { getAvailableApiSites, getConfig, getValidUser } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { getMainlandSearchQueries } from '@/lib/mainland-search';
import { orderSourcesByHealth, recordSourceSearch } from '@/lib/source-health';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};
const SOURCE_SEARCH_CONCURRENCY = 6;

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  const user = await getValidUser(authInfo?.username);
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const mode = searchParams.get('mode');

  if (!query) {
    return NextResponse.json(
      { results: [] },
      {
        headers: PRIVATE_NO_STORE_HEADERS,
      }
    );
  }

  if (!isValidApiSearchQuery(query)) {
    return NextResponse.json(
      { error: 'Invalid query parameter' },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const config = await getConfig();
  const apiSites = orderSourcesByHealth(
    await getAvailableApiSites(user.username)
  );

  const directMode = mode === 'direct';
  const searchVariants = directMode
    ? getMainlandSearchQueries(query).slice(0, 1)
    : getMainlandSearchQueries(query);
  const cleanedOriginal = searchVariants[0] || cleanQueryForApi(query);

  try {
    const results = await mapWithConcurrency(
      apiSites,
      SOURCE_SEARCH_CONCURRENCY,
      async (site) => {
        const startedAt = Date.now();
        const linked = createLinkedAbortController(request.signal, 6000);
        try {
          const found = await searchFromApi(
            site,
            cleanedOriginal,
            searchVariants,
            linked.controller.signal
          );
          recordSourceSearch(
            site.key,
            Date.now() - startedAt,
            linked.controller.signal.aborted && !request.signal.aborted
          );
          return found;
        } catch (error) {
          console.warn(`搜尋失敗 ${site.name}:`, error);
          return [];
        } finally {
          linked.cleanup();
        }
      }
    );
    let flattenedResults = results.flat();
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    if (flattenedResults.length === 0) {
      // no cache if empty
      return NextResponse.json(
        { results: [], primaryQuery: cleanedOriginal },
        { status: 200, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }

    return NextResponse.json(
      { results: flattenedResults, primaryQuery: cleanedOriginal },
      {
        headers: PRIVATE_NO_STORE_HEADERS,
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: '搜尋失敗' },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
