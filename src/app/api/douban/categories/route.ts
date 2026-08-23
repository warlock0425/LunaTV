import { NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/api-rate-limit';
import { setBoundedMapValue } from '@/lib/bounded-map';
import { getCacheTime } from '@/lib/config';
import { fetchDoubanData, toSimplified } from '@/lib/douban';
import { DoubanItem, DoubanResult } from '@/lib/types';

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

export const runtime = 'nodejs';

// 豆瓣分類 API 快取
const CATEGORIES_CACHE = new Map<
  string,
  { expiresAt: number; data: unknown }
>();
const CATEGORIES_CACHE_TTL = 60 * 1000; // 1 分鐘快取
const MAX_CATEGORIES_CACHE_ENTRIES = 200;

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, {
    namespace: 'douban-categories',
    limit: 120,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);

  // 取得參數
  const kind = searchParams.get('kind') || 'movie';
  const category = searchParams.get('category');
  const type = searchParams.get('type');
  const pageLimit = Number(searchParams.get('limit') ?? '20');
  const pageStart = Number(searchParams.get('start') ?? '0');

  // 驗證參數
  if (!kind || !category || !type) {
    return NextResponse.json(
      { error: '缺少必要參數: kind 或 category 或 type' },
      { status: 400 }
    );
  }

  if (!['tv', 'movie'].includes(kind)) {
    return NextResponse.json(
      { error: 'kind 參數必須是 tv 或 movie' },
      { status: 400 }
    );
  }

  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必須在 1-100 之間' },
      { status: 400 }
    );
  }

  if (!Number.isInteger(pageStart) || pageStart < 0 || pageStart > 10000) {
    return NextResponse.json(
      { error: 'pageStart 不能小於 0' },
      { status: 400 }
    );
  }

  const simCategory = toSimplified(category);
  const simType = toSimplified(type);

  // 檢查快取
  const cacheKey = `douban:categories:${kind}:${simCategory}:${simType}:${pageLimit}:${pageStart}`;
  const now = Date.now();
  const cached = CATEGORIES_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    const cacheTime = await getCacheTime();
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  }

  const target = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?start=${pageStart}&limit=${pageLimit}&category=${encodeURIComponent(
    simCategory
  )}&type=${encodeURIComponent(simType)}`;

  try {
    // 調用豆瓣 API
    const doubanData = await fetchDoubanData<DoubanCategoryApiResponse>(target);

    // 轉換數據格式
    const list: DoubanItem[] = doubanData.items.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    const response: DoubanResult = {
      code: 200,
      message: '取得成功',
      list: list,
    };

    // 存入快取
    setBoundedMapValue(
      CATEGORIES_CACHE,
      cacheKey,
      {
        expiresAt: Date.now() + CATEGORIES_CACHE_TTL,
        data: response,
      },
      MAX_CATEGORIES_CACHE_ENTRIES
    );

    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json({ error: '取得豆瓣數據失敗' }, { status: 500 });
  }
}
