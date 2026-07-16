import { NextRequest, NextResponse } from 'next/server';

import {
  isValidApiMediaId,
  isValidApiSource,
} from '@/lib/api-input-validation';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAvailableApiSites, getValidUser } from '@/lib/config';
import { getDetailFromApi } from '@/lib/downstream';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authInfo = getAuthInfoFromCookie(request);
  const user = await getValidUser(authInfo?.username);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const sourceCode = searchParams.get('source');

  if (!id || !sourceCode) {
    return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
  }

  if (!isValidApiSource(sourceCode) || !isValidApiMediaId(id)) {
    return NextResponse.json({ error: '無效的影片 ID 格式' }, { status: 400 });
  }

  try {
    const apiSites = await getAvailableApiSites(user.username);
    const apiSite = apiSites.find((site) => site.key === sourceCode);

    if (!apiSite) {
      return NextResponse.json({ error: '無效的API來源' }, { status: 400 });
    }

    const result = await getDetailFromApi(apiSite, id);

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
