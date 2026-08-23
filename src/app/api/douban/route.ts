import { NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/api-rate-limit';
import { setBoundedMapValue } from '@/lib/bounded-map';
import { getCacheTime } from '@/lib/config';
import { fetchDoubanData, toSimplified } from '@/lib/douban';
import { DoubanItem, DoubanResult } from '@/lib/types';
import { readResponseTextWithLimit } from '@/lib/url-safety';

interface DoubanApiResponse {
  subjects: Array<{
    id: string;
    title: string;
    cover: string;
    rate: string;
  }>;
}

export const runtime = 'nodejs';

// 豆瓣 API 主路由快取，減少重複請求
const DOUBAN_CACHE = new Map<string, { expiresAt: number; data: unknown }>();
const DOUBAN_CACHE_TTL = 60 * 1000; // 1 分鐘快取，豆瓣熱門列表變化不頻繁
const MAX_DOUBAN_CACHE_ENTRIES = 200;
const MAX_TOP250_RESPONSE_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, {
    namespace: 'douban',
    limit: 120,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);

  // 取得參數
  const type = searchParams.get('type');
  const tag = searchParams.get('tag');
  const pageSize = Number(searchParams.get('pageSize') ?? '16');
  const pageStart = Number(searchParams.get('pageStart') ?? '0');

  // 驗證參數
  if (!type || !tag) {
    return NextResponse.json(
      { error: '缺少必要參數: type 或 tag' },
      { status: 400 }
    );
  }

  if (!['tv', 'movie'].includes(type)) {
    return NextResponse.json(
      { error: 'type 參數必須是 tv 或 movie' },
      { status: 400 }
    );
  }

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
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

  if (tag === 'top250') {
    return handleTop250(pageStart, pageSize);
  }

  // 檢查記憶體快取
  const cacheKey = `douban:${type}:${tag}:${pageSize}:${pageStart}`;
  const now = Date.now();
  const cached = DOUBAN_CACHE.get(cacheKey);
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

  const simTag = toSimplified(tag);
  const target = `https://movie.douban.com/j/search_subjects?type=${type}&tag=${encodeURIComponent(
    simTag
  )}&sort=recommend&page_limit=${pageSize}&page_start=${pageStart}`;

  try {
    // 調用豆瓣 API
    const doubanData = await fetchDoubanData<DoubanApiResponse>(target);

    // 轉換數據格式
    const list: DoubanItem[] = doubanData.subjects.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.cover,
      rate: item.rate,
      year: '',
    }));

    const response: DoubanResult = {
      code: 200,
      message: '取得成功',
      list: list,
    };

    // 存入記憶體快取
    setBoundedMapValue(
      DOUBAN_CACHE,
      cacheKey,
      {
        expiresAt: Date.now() + DOUBAN_CACHE_TTL,
        data: response,
      },
      MAX_DOUBAN_CACHE_ENTRIES
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
const TOP250_CACHE = new Map<string, { expiresAt: number; data: unknown }>();
const TOP250_CACHE_TTL = 60 * 60 * 1000; // Top250 變化非常慢，快取 1 小時

async function handleTop250(pageStart: number, pageSize: number) {
  const now = Date.now();
  const limitedPageSize = Math.min(pageSize, 25);
  const cacheKey = `${pageStart}:${limitedPageSize}`;
  const cached = TOP250_CACHE.get(cacheKey);
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

  const target = `https://movie.douban.com/top250?start=${pageStart}&filter=`;

  // 直接使用 fetch 取得 HTML 頁面
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
  };

  try {
    const fetchResponse = await fetch(target, fetchOptions);
    if (!fetchResponse.ok) {
      throw new Error(`HTTP error! Status: ${fetchResponse.status}`);
    }

    // 取得 HTML 內容
    const html = await readResponseTextWithLimit(
      fetchResponse,
      MAX_TOP250_RESPONSE_BYTES
    );

    // 透過正則同時捕獲影片 id、標題、封面以及評分
    const moviePattern =
      /<div class="item">[\s\S]*?<a[^>]+href="https?:\/\/movie\.douban\.com\/subject\/(\d+)\/"[\s\S]*?<img[^>]+alt="([^"]+)"[^>]*src="([^"]+)"[\s\S]*?<span class="rating_num"[^>]*>([^<]*)<\/span>[\s\S]*?<\/div>/g;
    const movies: DoubanItem[] = [];
    let match;

    while ((match = moviePattern.exec(html)) !== null) {
      const id = match[1];
      const title = match[2];
      const cover = match[3];
      const rate = match[4] || '';

      // 處理圖片 URL，確保使用 HTTPS
      const processedCover = cover.replace(/^http:/, 'https:');

      movies.push({
        id: id,
        title: title,
        poster: processedCover,
        rate: rate,
        year: '',
      });
    }

    const apiResponse: DoubanResult = {
      code: 200,
      message: '取得成功',
      list: movies.slice(0, limitedPageSize),
    };

    setBoundedMapValue(
      TOP250_CACHE,
      cacheKey,
      {
        expiresAt: Date.now() + TOP250_CACHE_TTL,
        data: apiResponse,
      },
      MAX_DOUBAN_CACHE_ENTRIES
    );

    const cacheTime = await getCacheTime();
    return NextResponse.json(apiResponse, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '取得豆瓣 Top250 數據失敗',
      },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
