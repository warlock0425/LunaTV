import { NextRequest, NextResponse } from 'next/server';

import {
  getAuthInfoFromCookie,
  getAuthSessionSecret,
  verifyAuthSession,
} from '@/lib/auth';
import { getFreshAdminUser } from '@/lib/config';
import { getSessionVersion } from '@/lib/security-store';
import { getServerStorageType } from '@/lib/storage-runtime';
import { isWeakSitePassword } from '@/lib/weak-password';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 跳過不需要認證的路徑
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  const storageType = getServerStorageType();

  if (!process.env.PASSWORD) {
    // 如果沒有設定密碼，重新導向到警告頁面
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }
  if (isWeakSitePassword(process.env.PASSWORD)) {
    const warningUrl = new URL('/warning', request.url);
    warningUrl.searchParams.set('reason', 'weak');
    return NextResponse.redirect(warningUrl);
  }

  // 從 cookie 取得認證資訊
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // localstorage 模式：在 middleware 中完成驗證（使用安全簽名驗證，不再比對 cookie 中的明文密碼）
  if (storageType === 'localstorage') {
    if (!authInfo.signature) {
      return handleAuthFailure(request, pathname);
    }
    const isValidSignature = await verifyAuthSession(
      authInfo,
      'localstorage',
      getAuthSessionSecret() || ''
    );
    if (isValidSignature) {
      const currentVersion = await getSessionVersion('localstorage');
      if ((authInfo.sessionVersion || 1) === currentVersion) {
        return NextResponse.next();
      }
    }
    return handleAuthFailure(request, pathname);
  }

  // 其他模式：只驗證簽名
  // 檢查是否有使用者名稱（非 localStorage 模式下密碼不儲存在 cookie 中）
  if (!authInfo.username || !authInfo.signature) {
    return handleAuthFailure(request, pathname);
  }

  // 驗證簽名（如果存在）
  if (authInfo.signature) {
    const isValidSignature = await verifyAuthSession(
      authInfo,
      authInfo.username,
      getAuthSessionSecret() || ''
    );

    // 簽名驗證通過即可
    if (isValidSignature) {
      const currentVersion = await getSessionVersion(authInfo.username);
      if ((authInfo.sessionVersion || 1) === currentVersion) {
        if (
          pathname.startsWith('/api/admin') &&
          !(await getFreshAdminUser(authInfo.username))
        ) {
          return handleAuthFailure(request, pathname);
        }
        return NextResponse.next();
      }
    }
  }

  // 簽名驗證失敗或不存在簽名
  return handleAuthFailure(request, pathname);
}

// 處理認證失敗的情況
function handleAuthFailure(
  request: NextRequest,
  pathname: string
): NextResponse {
  // 如果是 API 路由，回傳 401 狀態碼
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  // 否則重新導向到登入頁面
  const loginUrl = new URL('/login', request.url);
  // 保留完整的 URL，包括查詢參數
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  return NextResponse.redirect(loginUrl);
}

// 判斷是否需要跳過認證的路徑
export function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/sw.js',
    '/icons/',
    '/logo.png',
    '/offline.html',
    '/splash/',
    '/screenshot1.png',
    '/screenshot2.png',
    '/screenshot3.png',
  ];

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 設定 proxy 匹配規則（Next 16 起 middleware 更名為 proxy，固定 Node.js runtime）
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|sw.js|login|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/health).*)',
  ],
};
