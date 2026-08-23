import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { readJsonObject } from '@/lib/api-input-validation';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import {
  resetAllBreakers,
  resetSourceBreaker,
} from '@/lib/source-circuit-breaker';
import { resetSourceHealth } from '@/lib/source-health';
import { clearValidationResult } from '@/lib/source-validation';

export const runtime = 'nodejs';

/**
 * POST /api/admin/source/health-reset
 * body: { key?: string }  // 省略 key 時重置全部
 *
 * 只清記憶體中的健康/熔斷/最近三級檢測結果，不改 SourceConfig 啟停。
 */
export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  if (!(await requireAdmin(request))) {
    return NextResponse.json({ error: '權限不足' }, { status: 401 });
  }

  const body = (await readJsonObject<{ key?: unknown }>(request)) || {};
  const key = typeof body.key === 'string' ? body.key.trim() : '';

  if (key) {
    resetSourceHealth(key);
    resetSourceBreaker(key);
    clearValidationResult(key);
    return NextResponse.json({ ok: true, scope: 'one', key });
  }

  resetSourceHealth();
  resetAllBreakers();
  clearValidationResult();
  return NextResponse.json({ ok: true, scope: 'all' });
}
