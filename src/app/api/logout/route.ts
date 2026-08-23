import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import {
  getAuthCookieOptions,
  getUserInfoCookieOptions,
} from '@/lib/auth-cookie';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { revokeUserSessions } from '@/lib/security-store';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const revokeAll = request.nextUrl.searchParams.get('all') === 'true';
  const hasOrigin = Boolean(request.headers.get('origin'));

  // 撤銷所有裝置必須同源。本機清 cookie：瀏覽器會帶 Origin，跨站會被擋；
  // Playwright APIRequest 與部分客戶端不帶 Origin，仍允許只清本機 cookie。
  if (revokeAll || hasOrigin) {
    const crossSite = rejectCrossSiteRequest(request);
    if (crossSite) return crossSite;
  }

  if (revokeAll) {
    const user = await requireActiveUser(request);
    if (user) {
      await revokeUserSessions(user.username);
    }
  }

  const response = NextResponse.json({ ok: true });
  const expired = new Date(0);

  response.cookies.set('auth', '', getAuthCookieOptions(request, expired));
  response.cookies.set(
    'user_info',
    '',
    getUserInfoCookieOptions(request, expired)
  );

  return response;
}
