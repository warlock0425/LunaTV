/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { requireActiveUser } from '@/lib/api-auth';
import { isValidApiSearchQuery } from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { toSearchSimplified } from '@/lib/chinese';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { getMainlandSearchQueries } from '@/lib/mainland-search';
import { splitTitleWords } from '@/lib/string-utils';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};
const SEARCH_SUGGESTIONS_RATE_LIMIT = 120;
const SEARCH_SUGGESTIONS_RATE_WINDOW_SECONDS = 60;

export async function GET(request: NextRequest) {
  try {
    const activeUser = await requireActiveUser(request);
    if (!activeUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }
    const limited = await enforceRateLimit(request, {
      namespace: 'api-search-suggestions',
      limit: SEARCH_SUGGESTIONS_RATE_LIMIT,
      windowSeconds: SEARCH_SUGGESTIONS_RATE_WINDOW_SECONDS,
    });
    if (limited) return limited;

    const username = activeUser.username;

    const config = await getConfig();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();

    if (!query) {
      return NextResponse.json(
        { suggestions: [] },
        { headers: PRIVATE_NO_STORE_HEADERS }
      );
    }

    if (!isValidApiSearchQuery(query)) {
      return NextResponse.json(
        { error: 'Invalid query parameter' },
        { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }

    // 生成建議
    const suggestions = await generateSuggestions(config, query, username);

    return NextResponse.json(
      { suggestions },
      {
        headers: PRIVATE_NO_STORE_HEADERS,
      }
    );
  } catch (error) {
    console.error('取得搜尋建議失敗', error);
    return NextResponse.json(
      { error: '取得搜尋建議失敗' },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}

async function generateSuggestions(
  config: AdminConfig,
  query: string,
  username: string
): Promise<
  Array<{
    text: string;
    type: 'exact' | 'related' | 'suggestion';
    score: number;
  }>
> {
  const queryLower = query.toLowerCase();
  // 與主搜尋同一套陸名計畫；建議是即時路徑，只取第 1 個查詢
  const planned = getMainlandSearchQueries(query);
  const primaryQuery = planned[0] || query;
  const matchNeedles = Array.from(
    new Set(
      [
        queryLower,
        toSearchSimplified(query).toLowerCase(),
        primaryQuery.toLowerCase(),
        ...planned.map((p) => p.toLowerCase()),
      ].filter(Boolean)
    )
  );

  const apiSites = await getAvailableApiSites(username);
  let realKeywords: string[] = [];

  if (apiSites.length > 0) {
    const firstSite = apiSites[0];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    let results;
    try {
      results = await searchFromApi(
        firstSite,
        primaryQuery,
        planned.length > 0 ? [primaryQuery] : undefined,
        controller.signal
      );
    } finally {
      clearTimeout(timeoutId);
    }

    realKeywords = Array.from(
      new Set(
        results
          .filter(
            (r: any) =>
              config.SiteConfig.DisableYellowFilter ||
              !yellowWords.some((word: string) =>
                (r.type_name || '').includes(word)
              )
          )
          .map((r: any) => r.title)
          .filter(Boolean)
          .flatMap((title: string) => splitTitleWords(title))
          .filter((w: string) => {
            if (w.length <= 1) return false;
            const wordLower = w.toLowerCase();
            // 台譯輸入時標題多為陸名，需用計畫／簡化字串比對，不能只 includes 原文
            return matchNeedles.some(
              (needle) =>
                wordLower.includes(needle) || needle.includes(wordLower)
            );
          })
      )
    ).slice(0, 8);
  }

  // 根據關鍵詞與查詢的匹配程度計算分數，並動態確定類型
  const realSuggestions = realKeywords.map((word) => {
    const wordLower = word.toLowerCase();
    const queryWords = splitTitleWords(queryLower);

    // 計算匹配分數：完全匹配得分更高
    let score = 1.0;
    if (wordLower === queryLower) {
      score = 2.0; // 完全匹配
    } else if (
      wordLower.startsWith(queryLower) ||
      wordLower.endsWith(queryLower)
    ) {
      score = 1.8; // 前綴或後綴匹配
    } else if (queryWords.some((qw) => wordLower.includes(qw))) {
      score = 1.5; // 包含查詢詞
    }

    // 根據匹配程度確定類型
    let type: 'exact' | 'related' | 'suggestion' = 'related';
    if (score >= 2.0) {
      type = 'exact';
    } else if (score >= 1.5) {
      type = 'related';
    } else {
      type = 'suggestion';
    }

    return {
      text: word,
      type,
      score,
    };
  });

  // 按分數降序排列，相同分數按類型優先級排列
  const sortedSuggestions = realSuggestions.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score; // 分數高的在前
    }
    // 分數相同時，按類型優先級：exact > related > suggestion
    const typePriority = { exact: 3, related: 2, suggestion: 1 };
    return typePriority[b.type] - typePriority[a.type];
  });

  return sortedSuggestions;
}
