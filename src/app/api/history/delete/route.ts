import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import {
  hasDisallowedUserOverride,
  isValidApiTextParam,
  readJsonObject,
} from '@/lib/api-input-validation';
import { db } from '@/lib/db';
import { normalizePlayRecordTitle } from '@/lib/string-utils';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonObject(req);
    if (!body) {
      return NextResponse.json(
        { success: false, error: '請求格式錯誤' },
        { status: 400 }
      );
    }
    const { vod_name } = body;
    const activeUser = await requireActiveUser(req);
    if (!activeUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // 身分一律以 cookie 為準，拒絕客戶端指定 user/username。
    const username = activeUser.username;
    if (hasDisallowedUserOverride(req, body)) {
      return NextResponse.json(
        { success: false, error: '不得指定其他使用者' },
        { status: 400 }
      );
    }

    if (!vod_name || !isValidApiTextParam(vod_name)) {
      return NextResponse.json(
        { success: false, error: '缺少關鍵欄位' },
        { status: 400 }
      );
    }

    if (
      (body.source && !isValidApiTextParam(body.source)) ||
      (body.source_name && !isValidApiTextParam(body.source_name))
    ) {
      return NextResponse.json(
        { success: false, error: 'Invalid request parameter' },
        { status: 400 }
      );
    }

    // 2. 將目標劇名進行標準化清洗（繁體化、去標點、去空格）
    const targetTitle = normalizePlayRecordTitle(vod_name);
    if (!targetTitle) {
      return NextResponse.json(
        { success: false, error: '標題正規化後不得為空' },
        { status: 400 }
      );
    }

    const requestedSource =
      typeof body.source_name === 'string'
        ? body.source_name
        : typeof body.source === 'string'
          ? body.source
          : undefined;

    await db.deletePlayRecordsByTitle(username, vod_name, requestedSource);

    return NextResponse.json({
      success: true,
      message: '資料庫實體髒數據已完全清洗',
    });
  } catch (err: unknown) {
    console.error('刪除播放記錄失敗:', err);
    return NextResponse.json(
      { success: false, error: '刪除播放記錄失敗' },
      { status: 500 }
    );
  }
}
