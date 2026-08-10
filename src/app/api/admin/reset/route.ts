import { NextRequest, NextResponse } from 'next/server';

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { resetConfig } from '@/lib/config';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

/**
 * 狀態變更必須走 POST，且要求 Origin 的 host 與本站一致。
 * GET + SameSite=Lax 可被跨站頂層導覽帶 cookie 觸發（CSRF）。
 *
 * 只比 host、不比 scheme：Cloudflare／反向代理在邊緣終止 TLS 時，
 * 瀏覽器 Origin 是 https://…，容器看到的 nextUrl 卻是 http://…，
 * 比完整 origin 會在正式站誤 403。攻擊頁的 host 一定不同，比 host 足夠。
 */
function isSameSiteHost(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const originHost = new URL(origin).host.toLowerCase();
    // 優先信任代理轉發的對外 host（內部 hop 的 Host 常是容器位址）
    const forwarded = request.headers.get('x-forwarded-host');
    const expectedHost = (
      forwarded?.split(',')[0]?.trim() ||
      request.headers.get('host') ||
      ''
    ).toLowerCase();
    if (!expectedHost) return false;
    return originHost === expectedHost;
  } catch {
    return false;
  }
}

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
  if (!isSameSiteHost(request)) {
    return NextResponse.json(
      { error: 'Forbidden' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支援本地儲存進行管理員設定',
      },
      { status: 400 }
    );
  }

  const authInfo = await getVerifiedAuthInfo(request);
  if (!authInfo || !authInfo.username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const username = authInfo.username;

  if (username !== process.env.USERNAME) {
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
