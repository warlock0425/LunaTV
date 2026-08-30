import { NextResponse } from 'next/server';

import type { BangumiCalendarData } from '@/lib/bangumi.client';
import { BANGUMI_USER_AGENT } from '@/lib/bangumi-aliases';
import { readResponseJsonWithLimit } from '@/lib/response-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL = 6 * 60 * 60 * 1000;
// api.bgm.tv 回應大小不在我方控制內；與豆瓣路徑同樣設 5MB 上限。
const MAX_CALENDAR_RESPONSE_BYTES = 5 * 1024 * 1024;
let calendarCache: {
  expiresAt: number;
  data: BangumiCalendarData[];
} | null = null;

export async function GET() {
  const now = Date.now();
  if (calendarCache && calendarCache.expiresAt > now) {
    return createCalendarResponse(calendarCache.data);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch('https://api.bgm.tv/calendar', {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...getBangumiAuthHeaders(),
        'User-Agent': BANGUMI_USER_AGENT,
      },
    });
    if (!response.ok) {
      return createCalendarResponse(calendarCache?.data || []);
    }

    const data = await readResponseJsonWithLimit<BangumiCalendarData[]>(
      response,
      MAX_CALENDAR_RESPONSE_BYTES
    );
    const filteredData = data.map((item) => ({
      ...item,
      items: item.items.filter((bangumiItem) => bangumiItem.images),
    }));

    calendarCache = {
      expiresAt: now + CACHE_TTL,
      data: filteredData,
    };

    return createCalendarResponse(filteredData);
  } catch {
    return createCalendarResponse(calendarCache?.data || []);
  } finally {
    clearTimeout(timeoutId);
  }
}

function createCalendarResponse(data: BangumiCalendarData[]) {
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=21600, s-maxage=21600',
    },
  });
}

function getBangumiAuthHeaders(): Record<string, string> {
  const token = process.env.BANGUMI_ACCESS_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
