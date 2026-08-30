import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { isValidApiSearchQuery } from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { cleanQueryForApi } from '@/lib/chinese';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { getMainlandSearchQueries } from '@/lib/mainland-search';
import { fanoutSearchSources } from '@/lib/search-fanout';
import { orderSourcesByHealth } from '@/lib/source-health';
import { orderSourcesByValidation } from '@/lib/source-validation';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};
/** 多源 × 變體，比 image-proxy 嚴，但比腳本刷量寬（使用者主動行為） */
const SEARCH_RATE_LIMIT = 90;
const SEARCH_RATE_WINDOW_SECONDS = 60;

export async function GET(request: NextRequest) {
  const activeUser = await requireActiveUser(request);
  if (!activeUser) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  const limited = await enforceRateLimit(request, {
    namespace: 'api-search',
    limit: SEARCH_RATE_LIMIT,
    windowSeconds: SEARCH_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  const username = activeUser.username;

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
  let apiSites = orderSourcesByHealth(await getAvailableApiSites(username));
  if (config.SiteConfig.PreferValidatedSourceOrder) {
    apiSites = orderSourcesByValidation(apiSites);
  }

  const directMode = mode === 'direct';
  const searchVariants = directMode
    ? getMainlandSearchQueries(query).slice(0, 1)
    : getMainlandSearchQueries(query);
  const cleanedOriginal = searchVariants[0] || cleanQueryForApi(query);

  try {
    const siteResults = await fanoutSearchSources({
      sites: apiSites,
      query: cleanedOriginal,
      variants: searchVariants,
      parentSignal: request.signal,
    });
    let flattenedResults = siteResults.flatMap((entry) => entry.results);
    if (!config.SiteConfig.DisableYellowFilter) {
      flattenedResults = flattenedResults.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    if (flattenedResults.length === 0) {
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
