import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { listSearchZeroResults } from '@/lib/search-zero-results';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 唯讀：最近搜尋零結果的查詢詞（站級、不綁使用者）。
 * 供站長補台譯表時對照真實踩坑清單。
 */
export async function GET(request: NextRequest) {
  try {
    if (!(await requireAdmin(request))) {
      return NextResponse.json({ error: '權限不足' }, { status: 401 });
    }

    const entries = await listSearchZeroResults();
    return NextResponse.json(
      { entries },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return NextResponse.json({ error: '取得失敗' }, { status: 500 });
  }
}
