/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  isValidApiTextParam,
  parseAndValidateApiStorageKey,
  readJsonObject,
} from '@/lib/api-input-validation';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { Favorite } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * GET /api/favorites
 *
 * 支援兩種調用方式：
 * 1. 不帶 query，返回全部收藏列表（Record<string, Favorite>）。
 * 2. 帶 key=source+id，返回單條收藏（Favorite | null）。
 */
export async function GET(request: NextRequest) {
  try {
    // 從 cookie 取得使用者資訊
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
    const key = searchParams.get('key');

    // 查詢單條收藏
    if (key) {
      const parsedKey = parseAndValidateApiStorageKey(key);
      if (!parsedKey) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
      const { source, id } = parsedKey;
      const fav = await db.getFavorite(authInfo.username, source, id);
      return NextResponse.json(fav, { status: 200 });
    }

    // 查詢全部收藏
    const favorites = await db.getAllFavorites(authInfo.username);
    return NextResponse.json(favorites, { status: 200 });
  } catch (err) {
    console.error('取得收藏失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/favorites
 * body: { key: string; favorite: Favorite }
 */
export async function POST(request: NextRequest) {
  try {
    // 從 cookie 取得使用者資訊
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

    const body = await readJsonObject<{
      key?: string;
      favorite?: Favorite;
    }>(request);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { key, favorite } = body;

    if (!key || !favorite) {
      return NextResponse.json(
        { error: 'Missing key or favorite' },
        { status: 400 }
      );
    }

    // 驗證必要字段
    if (
      !favorite.title ||
      !favorite.source_name ||
      !isValidApiTextParam(favorite.title) ||
      !isValidApiTextParam(favorite.source_name) ||
      (favorite.save_time !== undefined &&
        (!Number.isFinite(favorite.save_time) || favorite.save_time <= 0))
    ) {
      return NextResponse.json(
        { error: 'Invalid favorite data' },
        { status: 400 }
      );
    }

    const parsedKey = parseAndValidateApiStorageKey(key);
    if (!parsedKey) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }
    const { source, id } = parsedKey;

    const finalFavorite = {
      ...favorite,
      save_time: favorite.save_time ?? Date.now(),
    } as Favorite;

    await db.saveFavorite(authInfo.username, source, id, finalFavorite);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('儲存收藏失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/favorites
 *
 * 1. 不帶 query -> 清空全部收藏
 * 2. 帶 key=source+id -> 刪除單條收藏
 */
export async function DELETE(request: NextRequest) {
  try {
    // 從 cookie 取得使用者資訊
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

    const username = authInfo.username;
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      // 刪除單條
      const parsedKey = parseAndValidateApiStorageKey(key);
      if (!parsedKey) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
      const { source, id } = parsedKey;
      await db.deleteFavorite(username, source, id);
    } else {
      // 清空全部
      await db.deleteAllFavorites(username);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('刪除收藏失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
