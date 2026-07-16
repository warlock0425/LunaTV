import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getValidUser } from '@/lib/config';

export const runtime = 'nodejs';
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

// OrionTV 兼容接口
export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  const user = await getValidUser(authInfo?.username);
  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  try {
    const apiSites = await getAvailableApiSites(user.username);

    return NextResponse.json(apiSites, {
      headers: PRIVATE_NO_STORE_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      { error: '獲取資源失敗' },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
