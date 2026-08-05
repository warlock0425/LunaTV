/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { requireActiveUser } from '@/lib/api-auth';
import { isValidApiSearchQuery } from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { splitTitleWords } from '@/lib/string-utils';
import { yellowWords } from '@/lib/yellow';

import {
  getSuggestionMatchNeedles,
  getSuggestionPrimaryQuery,
  suggestionWordMatchesNeedles,
} from './suggestion-queries';

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
  // production 查詢計畫：見 suggestion-queries.ts（測試 import 同一份）
  const primaryQuery = getSuggestionPrimaryQuery(query);
  const matchNeedles = getSuggestionMatchNeedles(query);
  const useMainlandPrimary = primaryQuery !== query;

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
        useMainlandPrimary ? [primaryQuery] : undefined,
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
          .filter((w: string) => suggestionWordMatchesNeedles(w, matchNeedles))
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
