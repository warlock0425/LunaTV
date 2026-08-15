import { NextRequest, NextResponse } from 'next/server';

import {
  getAuthCookieOptions,
  getUserInfoCookieOptions,
} from '@/lib/auth-cookie';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
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
