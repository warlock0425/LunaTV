import { NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/api-rate-limit';
import { setBoundedMapValue } from '@/lib/bounded-map';
import {
  buildDoubanSearchUrl,
  DoubanSearchResponse,
  extractMainlandAliases,
  isAliasWorthRetrying,
  pickPrimaryAlias,
} from '@/lib/douban-alias';
import { readResponseTextWithLimit } from '@/lib/url-safety';

export const runtime = 'nodejs';

/**
 * 台灣片名 → 大陸片名 的別名解析端點。
 *
 * 只在搜尋完全沒有結果時由前端呼叫，因此請求量極低；快取放在伺服器端
 * 讓所有使用者共用，避免各自打豆瓣造成限流（實測連續請求會被擋）。
 */

const ALIAS_CACHE = new Map<
  string,
  { expiresAt: number; aliases: string[]; primary: string | null }
>();
const ALIAS_CACHE_TTL = 24 * 60 * 60 * 1000; // 片名對照極少變動
const NEGATIVE_CACHE_TTL = 10 * 60 * 1000; // 查無結果時短暫記住，避免反覆重試
const MAX_ALIAS_CACHE_ENTRIES = 500;
const MAX_QUERY_LENGTH = 60;
const FETCH_TIMEOUT_MS = 6000;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MIN_REQUEST_INTERVAL_MS = 500; // 對豆瓣的節流間隔

let lastRequestAt = 0;
let inFlight: Promise<void> = Promise.resolve();

/** 將對豆瓣的請求串成序列並保持最小間隔，避免觸發限流 */
function throttle(): Promise<void> {
  const scheduled = inFlight.then(async () => {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();
  });
  inFlight = scheduled.catch(() => undefined);
  return scheduled;
}

function jsonResponse(aliases: string[], primary: string | null) {
  return NextResponse.json(
    { aliases, primary },
    { headers: { 'Cache-Control': 'private, max-age=3600' } }
  );
}

export async function GET(request: Request) {
  // 只在搜尋完全沒結果時才會被呼叫，正常使用量極低；額度抓得比其他豆瓣端點緊，
  // 因為每次快取未命中都是一次對豆瓣的搜尋請求（實測連續請求會被對方擋）。
  const limited = await enforceRateLimit(request, {
    namespace: 'douban-alias',
    limit: 30,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const rawQuery = (searchParams.get('q') || '').trim();
  const proxyType = searchParams.get('proxyType') || 'cmliussss-cdn-tencent';

  if (!rawQuery || rawQuery.length > MAX_QUERY_LENGTH) {
    return NextResponse.json(
      { error: '查詢參數無效', aliases: [], primary: null },
      { status: 400 }
    );
  }

  const cacheKey = `${proxyType}:${rawQuery}`;
  const cached = ALIAS_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return jsonResponse(cached.aliases, cached.primary);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    await throttle();
    const response = await fetch(buildDoubanSearchUrl(rawQuery, proxyType), {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Referer: 'https://movie.douban.com/',
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      // 豆瓣不可用時靜默降級，搜尋流程照舊
      return jsonResponse([], null);
    }

    const text = await readResponseTextWithLimit(response, MAX_RESPONSE_BYTES);
    const payload = JSON.parse(text) as DoubanSearchResponse;
    const itemCount = (payload.subjects?.items || payload.items || []).length;
    const aliases = extractMainlandAliases(payload, rawQuery).filter((alias) =>
      isAliasWorthRetrying(alias, rawQuery)
    );
    const primary = pickPrimaryAlias(aliases);

    // 豆瓣被限流時同樣回 200 但 items 為空，與「確實查無此片」無法從狀態碼區分。
    // 快取這種空回應會讓使用者在冷卻期內一直拿到錯誤的「沒有別名」，
    // 因此只有在豆瓣確實回傳了條目時才寫入快取。
    if (itemCount > 0) {
      setBoundedMapValue(
        ALIAS_CACHE,
        cacheKey,
        {
          expiresAt:
            Date.now() +
            (aliases.length > 0 ? ALIAS_CACHE_TTL : NEGATIVE_CACHE_TTL),
          aliases,
          primary,
        },
        MAX_ALIAS_CACHE_ENTRIES
      );
    }

    return jsonResponse(aliases, primary);
  } catch {
    // 逾時／網路錯誤／JSON 損壞：一律降級為「沒有別名」
    return jsonResponse([], null);
  } finally {
    clearTimeout(timeoutId);
  }
}
