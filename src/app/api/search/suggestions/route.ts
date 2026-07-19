/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { isValidApiSearchQuery } from '@/lib/api-input-validation';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getConfig, getValidUser } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

export async function GET(request: NextRequest) {
  try {
    // 從 cookie 取得使用者資訊
    const authInfo = getAuthInfoFromCookie(request);
    const user = await getValidUser(authInfo?.username);
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }

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
    const suggestions = await generateSuggestions(config, query, user.username);

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
        query,
        undefined,
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
          .flatMap((title: string) => title.split(/[ -:：·、-]/))
          .filter(
            (w: string) => w.length > 1 && w.toLowerCase().includes(queryLower)
          )
      )
    ).slice(0, 8);
  }

  // 根據關鍵詞與查詢的匹配程度計算分數，並動態確定類型
  const realSuggestions = realKeywords.map((word) => {
    const wordLower = word.toLowerCase();
    const queryWords = queryLower.split(/[ -:：·、-]/);

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
