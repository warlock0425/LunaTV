import { NextRequest, NextResponse } from 'next/server';

import {
  isValidApiTextParam,
  readJsonObject,
} from '@/lib/api-input-validation';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { storage } from '@/lib/storage';
import { cleanSourceName, normalizePlayRecordTitle } from '@/lib/string-utils';

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
    const { vod_name, userId } = body;
    const authInfo = getAuthInfoFromCookie(req);

    if (!vod_name || !isValidApiTextParam(vod_name)) {
      return NextResponse.json(
        { success: false, error: '缺少關鍵欄位' },
        { status: 400 }
      );
    }

    // 1. 撈出 Redis / Kvrocks 中該使用者所有的觀看雜湊表
    if (
      (userId && !isValidApiTextParam(userId, 128)) ||
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

    const mockUserId = authInfo?.username || userId || 'default_user';
    const userHistory =
      (await storage.hgetall(`user:history:${mockUserId}`)) || {};

    // 允許前端傳入 source 做精確比對，避免抹除不同來源的同名記錄
    const requestedSource =
      typeof body.source_name === 'string'
        ? body.source_name
        : typeof body.source === 'string'
          ? body.source
          : undefined;
    const sourceForMatch = cleanSourceName(requestedSource);

    // 3. 遍歷所有鍵值，只要劇名匹配，立刻執行 HDEL 徹底抹除，絕不留活口
    for (const [fieldKey, rawValue] of Object.entries(userHistory)) {
      if (!rawValue) continue;
      try {
        const recordData = JSON.parse(rawValue);
        const recordTitle = recordData.title || recordData.vod_name || '';
        const cleanRecordTitle = normalizePlayRecordTitle(recordTitle);

        const sourceInRecord = cleanSourceName(
          recordData.source || recordData.source_name
        );

        // 刪除資料必須精確匹配正規化後的標題；模糊包含會誤刪短標題的其他作品。
        if (cleanRecordTitle && cleanRecordTitle === targetTitle) {
          if (sourceForMatch && sourceInRecord !== sourceForMatch) continue;
          await storage.hdel(`user:history:${mockUserId}`, fieldKey);
        }
      } catch (e) {
        // 舊的或損壞的 JSON 忽略
        continue;
      }
    }

    return NextResponse.json({
      success: true,
      message: '資料庫實體髒數據已完全清洗',
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    );
  }
}
