/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/api-rate-limit';
import { setBoundedMapValue } from '@/lib/bounded-map';
import { getCacheTime } from '@/lib/config';
import { fetchDoubanData, toSimplified } from '@/lib/douban';
import { logger } from '@/lib/logger';
import { DoubanResult } from '@/lib/types';
interface DoubanRecommendApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    year: string;
    type: string;
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

// 豆瓣推薦 API 快取
const RECOMMENDS_CACHE = new Map<
  string,
  { expiresAt: number; data: unknown }
>();
const RECOMMENDS_CACHE_TTL = 60 * 1000; // 1 分鐘快取
const MAX_RECOMMENDS_CACHE_ENTRIES = 200;

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, {
    namespace: 'douban-recommends',
    limit: 120,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);

  // 取得參數
  const kind = searchParams.get('kind');
  const pageLimit = Number(searchParams.get('limit') ?? '20');
  const pageStart = Number(searchParams.get('start') ?? '0');
  const categoryRaw = searchParams.get('category');
  const formatRaw = searchParams.get('format');
  const regionRaw = searchParams.get('region');
  const yearRaw = searchParams.get('year');
  const platformRaw = searchParams.get('platform');
  const sortRaw = searchParams.get('sort');
  const labelRaw = searchParams.get('label');

  const category =
    categoryRaw === 'all' || !categoryRaw ? '' : toSimplified(categoryRaw);
  const format =
    formatRaw === 'all' || !formatRaw ? '' : toSimplified(formatRaw);
  const region =
    regionRaw === 'all' || !regionRaw ? '' : toSimplified(regionRaw);
  const year = yearRaw === 'all' || !yearRaw ? '' : toSimplified(yearRaw);
  const platform =
    platformRaw === 'all' || !platformRaw ? '' : toSimplified(platformRaw);
  const sort = sortRaw === 'T' || !sortRaw ? '' : sortRaw;
  const label = labelRaw === 'all' || !labelRaw ? '' : toSimplified(labelRaw);

  if (!kind) {
    return NextResponse.json({ error: '缺少必要參數: kind' }, { status: 400 });
  }
  if (kind !== 'movie' && kind !== 'tv') {
    return NextResponse.json(
      { error: 'kind 參數必須是 tv 或 movie' },
      { status: 400 }
    );
  }
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'limit 必須在 1-100 之間' },
      { status: 400 }
    );
  }
  if (!Number.isInteger(pageStart) || pageStart < 0 || pageStart > 10000) {
    return NextResponse.json(
      { error: 'start 必須在 0-10000 之間' },
      { status: 400 }
    );
  }

  const selectedCategories = { 类型: category } as any;
  if (format) {
    selectedCategories['形式'] = format;
  }
  if (region) {
    selectedCategories['地区'] = region;
  }

  const tags = [] as Array<string>;
  if (category) {
    tags.push(category);
  }
  if (!category && format) {
    tags.push(format);
  }
  if (label) {
    tags.push(label);
  }
  if (region) {
    tags.push(region);
  }
  if (year) {
    tags.push(year);
  }
  if (platform) {
    tags.push(platform);
  }

  const baseUrl = `https://m.douban.com/rexxar/api/v2/${kind}/recommend`;
  const params = new URLSearchParams();
  params.append('refresh', '0');
  params.append('start', pageStart.toString());
  params.append('count', pageLimit.toString());
  params.append('selected_categories', JSON.stringify(selectedCategories));
  params.append('uncollect', 'false');
  params.append('score_range', '0,10');
  params.append('tags', tags.join(','));
  if (sort) {
    params.append('sort', sort);
  }

  const target = `${baseUrl}?${params.toString()}`;

  // 檢查快取
  const cacheKey = `douban:recommends:${target}`;
  const now = Date.now();
  const cached = RECOMMENDS_CACHE.get(cacheKey);
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

  logger.debug('Douban recommends request:', target);
  try {
    const doubanData =
      await fetchDoubanData<DoubanRecommendApiResponse>(target);
    const list = doubanData.items
      .filter((item) => item.type == 'movie' || item.type == 'tv')
      .map((item) => ({
        id: item.id,
        title: item.title,
        poster: item.pic?.normal || item.pic?.large || '',
        rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
        year: item.year,
      }));
    const response: DoubanResult = {
      code: 200,
      message: '取得成功',
      list: list,
    };

    // 存入快取
    setBoundedMapValue(
      RECOMMENDS_CACHE,
      cacheKey,
      {
        expiresAt: Date.now() + RECOMMENDS_CACHE_TTL,
        data: response,
      },
      MAX_RECOMMENDS_CACHE_ENTRIES
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
