import { NextResponse } from 'next/server';

import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Selene / Selene-TV 登入後會打這支探測連線（不帶 cookie）。
 * 只回 ok 與版本，不含使用者資料或站內設定。
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      version: CURRENT_VERSION,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
