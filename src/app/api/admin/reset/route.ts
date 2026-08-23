import { NextRequest, NextResponse } from 'next/server';

import { requireOwner } from '@/lib/api-auth';
import { resetConfig } from '@/lib/config';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

/** GET 一律拒絕——舊書籤／惡意連結不得再觸發重置 */
export async function GET() {
  return NextResponse.json(
    { error: 'Method Not Allowed' },
    {
      status: 405,
      headers: {
        Allow: 'POST',
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支援本地儲存進行管理員設定',
      },
      { status: 400 }
    );
  }

  const owner = await requireOwner(request);
  if (!owner) {
    return NextResponse.json({ error: '僅支援站長重置設定' }, { status: 401 });
  }

  try {
    await resetConfig();

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '重置管理员設定失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
