import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import { getAvailableApiSites } from '@/lib/config';
import { toSeleneSearchResource } from '@/lib/selene-compat';

export const runtime = 'nodejs';
const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
};

// Selene／Selene-TV／OrionTV 相容：回 key/name/api/detail/from/disabled
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

    return NextResponse.json(apiSites.map(toSeleneSearchResource), {
      headers: PRIVATE_NO_STORE_HEADERS,
    });
  } catch (error) {
    return NextResponse.json(
      { error: '取得資源失敗' },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
}
