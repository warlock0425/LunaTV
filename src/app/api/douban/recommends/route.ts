/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

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

// 豆瓣推薦 API 緩存
const RECOMMENDS_CACHE = new Map<
  string,
  { expiresAt: number; data: unknown }
>();
const RECOMMENDS_CACHE_TTL = 60 * 1000; // 1 分鐘緩存
const MAX_RECOMMENDS_CACHE_ENTRIES = 200;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // 獲取參數
  const kind = searchParams.get('kind');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');
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
      message: '獲取成功',
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
    return NextResponse.json(
      { error: '獲取豆瓣數據失敗', details: (error as Error).message },
      { status: 500 }
    );
  }
}
