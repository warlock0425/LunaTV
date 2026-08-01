import { NextResponse } from 'next/server';

import { isValidApiNumericId } from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import {
  BANGUMI_ALIAS_CACHE_TTL_MS,
  isFreshBangumiAliasCacheEntry,
} from '@/lib/bangumi-alias-storage';
import { fetchBangumiSubjectAliases } from '@/lib/bangumi-aliases';
import { setBoundedMapValue } from '@/lib/bounded-map';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const CACHE_TTL = 6 * 60 * 60 * 1000;
const MAX_ALIAS_CACHE_ENTRIES = 500;
const ALIAS_CACHE = new Map<string, { expiresAt: number; aliases: string[] }>();

function jsonAliases(aliases: string[], cache = true) {
  return NextResponse.json(
    { aliases },
    {
      headers: {
        'Cache-Control': cache
          ? 'public, max-age=21600, s-maxage=21600'
          : 'no-store',
      },
    }
  );
}

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, {
    namespace: 'bangumi-aliases',
    limit: 60,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get('id') || '').trim();

  if (!id || !isValidApiNumericId(id)) {
    return NextResponse.json({ aliases: [] }, { status: 400 });
  }

  const now = Date.now();
  const cached = ALIAS_CACHE.get(id);
  if (cached && cached.expiresAt > now) {
    return jsonAliases(cached.aliases);
  }

  let staleAliases: string[] | null = null;
  try {
    const persistentCached = await db.getBangumiAliasCache(id);
    if (persistentCached && Array.isArray(persistentCached.aliases)) {
      staleAliases = persistentCached.aliases;
    }
    if (isFreshBangumiAliasCacheEntry(persistentCached, now)) {
      setBoundedMapValue(
        ALIAS_CACHE,
        id,
        {
          expiresAt: Math.min(persistentCached.expiresAt, now + CACHE_TTL),
          aliases: persistentCached.aliases,
        },
        MAX_ALIAS_CACHE_ENTRIES
      );
      return jsonAliases(persistentCached.aliases);
    }
  } catch {
    // Persistent cache is a best-effort optimization.
  }

  let aliases: string[];
  try {
    aliases = await fetchBangumiSubjectAliases(id);
  } catch {
    // 暫時性上游錯誤不可把空結果長時間快取；若有過期資料則降級使用。
    return jsonAliases(staleAliases || [], false);
  }
  setBoundedMapValue(
    ALIAS_CACHE,
    id,
    {
      expiresAt: now + CACHE_TTL,
      aliases,
    },
    MAX_ALIAS_CACHE_ENTRIES
  );

  try {
    await db.setBangumiAliasCache(id, {
      aliases,
      expiresAt: now + BANGUMI_ALIAS_CACHE_TTL_MS,
    });
  } catch {
    // Persistent cache is a best-effort optimization.
  }

  return jsonAliases(aliases);
}
