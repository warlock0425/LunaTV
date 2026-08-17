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

  if (revokeAll) {
    const crossSite = rejectCrossSiteRequest(request);
    if (crossSite) return crossSite;

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
