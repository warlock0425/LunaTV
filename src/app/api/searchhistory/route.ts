/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  isValidApiSearchQuery,
  readJsonObject,
} from '@/lib/api-input-validation';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 最大儲存條數（與客戶端保持一致）
const HISTORY_LIMIT = 20;

/**
 * GET /api/searchhistory
 * 返回 string[]
 */
export async function GET(request: NextRequest) {
  try {
    // 從 cookie 獲取使用者資訊
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站長，檢查使用者存在或被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username
      );
      if (!user) {
        return NextResponse.json({ error: '使用者不存在' }, { status: 401 });
      }
      if (user.banned) {
        return NextResponse.json({ error: '使用者已被封禁' }, { status: 401 });
      }
    }

    const history = await db.getSearchHistory(authInfo.username);
    return NextResponse.json(history.slice(0, HISTORY_LIMIT), { status: 200 });
  } catch (err) {
    console.error('獲取搜尋歷史失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/searchhistory
 * body: { keyword: string }
 */
export async function POST(request: NextRequest) {
  try {
    // 從 cookie 獲取使用者資訊
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站長，檢查使用者存在或被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username
      );
      if (!user) {
        return NextResponse.json({ error: '使用者不存在' }, { status: 401 });
      }
      if (user.banned) {
        return NextResponse.json({ error: '使用者已被封禁' }, { status: 401 });
      }
    }

    const body = await readJsonObject<{ keyword?: unknown }>(request);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof body.keyword !== 'string') {
      return NextResponse.json(
        { error: 'Keyword is required' },
        { status: 400 }
      );
    }
    const keyword = body.keyword.trim();

    if (!keyword || !isValidApiSearchQuery(keyword)) {
      return NextResponse.json(
        { error: 'Keyword is required' },
        { status: 400 }
      );
    }

    await db.addSearchHistory(authInfo.username, keyword);

    // 再次獲取最新列表，確保客戶端與服務端同步
    const history = await db.getSearchHistory(authInfo.username);
    return NextResponse.json(history.slice(0, HISTORY_LIMIT), { status: 200 });
  } catch (err) {
    console.error('新增搜尋歷史失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/searchhistory?keyword=<kw>
 *
 * 1. 不帶 keyword -> 清空全部搜尋歷史
 * 2. 帶 keyword=<kw> -> 刪除單條關鍵字
 */
export async function DELETE(request: NextRequest) {
  try {
    // 從 cookie 獲取使用者資訊
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await getConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站長，檢查使用者存在或被封禁
      const user = config.UserConfig.Users.find(
        (u) => u.username === authInfo.username
      );
      if (!user) {
        return NextResponse.json({ error: '使用者不存在' }, { status: 401 });
      }
      if (user.banned) {
        return NextResponse.json({ error: '使用者已被封禁' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(request.url);
    const kw = searchParams.get('keyword')?.trim();

    if (kw && !isValidApiSearchQuery(kw)) {
      return NextResponse.json(
        { error: 'Invalid query parameter' },
        { status: 400 }
      );
    }

    await db.deleteSearchHistory(authInfo.username, kw || undefined);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('刪除搜尋歷史失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
