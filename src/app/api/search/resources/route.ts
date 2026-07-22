import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites } from '@/lib/config';

export const runtime = 'nodejs';
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  const activeUser = await requireActiveUser(request);
  if (!activeUser) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  const username = activeUser.username;
  try {
    const apiSites = await getAvailableApiSites(username);

    return NextResponse.json(apiSites, {
      headers: PRIVATE_NO_STORE_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      { error: '取得資源失敗' },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
