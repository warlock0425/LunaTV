import { NextResponse } from 'next/server';

import type { BangumiCalendarData } from '@/lib/bangumi.client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL = 6 * 60 * 60 * 1000;
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
        'User-Agent':
          'BerserkerTV/2.1.9 (+https://github.com/Berserker8888/LunaTV)',
      },
    });
    if (!response.ok) {
      return createCalendarResponse(calendarCache?.data || []);
    }

    const data = (await response.json()) as BangumiCalendarData[];
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
