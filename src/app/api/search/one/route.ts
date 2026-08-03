import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import {
  isValidApiSearchQuery,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { toSearchSimplified } from '@/lib/chinese';
import { createLinkedAbortController } from '@/lib/concurrency';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};
const SEARCH_ONE_RATE_LIMIT = 120;
const SEARCH_ONE_RATE_WINDOW_SECONDS = 60;

function normalizeSearchOneTitle(value: string): string {
  return toSearchSimplified(value)
    .toLowerCase()
    .replace(
      /[\s\-_.,:;!?()[\]{}'"`~@#$%^&*+=|\\/，。、《》〈〉「」『』（）【】［］：；！？．·・]/g,
      ''
    )
    .trim();
}

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  const activeUser = await requireActiveUser(request);
  if (!activeUser) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  const limited = await enforceRateLimit(request, {
    namespace: 'api-search-one',
    limit: SEARCH_ONE_RATE_LIMIT,
    windowSeconds: SEARCH_ONE_RATE_WINDOW_SECONDS,
  });
  if (limited) return limited;

  const username = activeUser.username;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('q');
  const resourceId = searchParams.get('resourceId');

  if (!query || !resourceId) {
    return NextResponse.json(
      { result: null, results: [], error: '缺少必要參數: q 或 resourceId' },
      {
        status: 400,
        headers: PRIVATE_NO_STORE_HEADERS,
      }
    );
  }

  if (!isValidApiSearchQuery(query) || !isValidApiSource(resourceId)) {
    return NextResponse.json(
      { result: null, results: [], error: 'Invalid query parameter' },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  const config = await getConfig();
  const apiSites = await getAvailableApiSites(username);

  try {
    // 根據 resourceId 查找對應的 API 站點
    const targetSite = apiSites.find((site) => site.key === resourceId);
    if (!targetSite) {
      return NextResponse.json(
        {
          error: `未找到指定的影片源: ${resourceId}`,
          result: null,
          results: [],
        },
        { status: 404, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }

    const linked = createLinkedAbortController(request.signal, 6000);
    let results: Awaited<ReturnType<typeof searchFromApi>>;
    try {
      results = await searchFromApi(
        targetSite,
        query,
        undefined,
        linked.controller.signal
      );
      if (linked.controller.signal.aborted && !request.signal.aborted) {
        return NextResponse.json(
          {
            error: `${targetSite.name} timeout`,
            result: null,
            results: [],
          },
          { status: 504, headers: PRIVATE_NO_STORE_HEADERS }
        );
      }
    } finally {
      linked.cleanup();
    }
    const normalizedQuery = normalizeSearchOneTitle(query);
    let result = results.filter(
      (r) => normalizeSearchOneTitle(r.title) === normalizedQuery
    );
    if (!config.SiteConfig.DisableYellowFilter) {
      result = result.filter((result) => {
        const typeName = result.type_name || '';
        return !yellowWords.some((word: string) => typeName.includes(word));
      });
    }
    if (result.length === 0) {
      return NextResponse.json(
        {
          error: '未找到結果',
          result: null,
          results: [],
        },
        { status: 404, headers: PRIVATE_NO_STORE_HEADERS }
      );
    } else {
      return NextResponse.json(
        { result, results: result },
        {
          headers: PRIVATE_NO_STORE_HEADERS,
        }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: '搜尋失敗',
        result: null,
        results: [],
      },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
