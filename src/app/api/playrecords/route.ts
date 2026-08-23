import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import {
  hasDisallowedUserOverride,
  isValidApiTextParam,
  parseAndValidateApiStorageKey,
  readJsonObject,
} from '@/lib/api-input-validation';
import { db } from '@/lib/db';
import { PlayRecord } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const activeUser = await requireActiveUser(request);
    if (!activeUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = activeUser.username;
    if (hasDisallowedUserOverride(request)) {
      return NextResponse.json(
        { error: '不得指定其他使用者' },
        { status: 400 }
      );
    }

    const records = await db.getAllPlayRecords(username);
    return NextResponse.json(records, { status: 200 });
  } catch (err) {
    console.error('取得播放記錄失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const activeUser = await requireActiveUser(request);
    if (!activeUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = activeUser.username;

    const body = await readJsonObject<{
      key?: string;
      record?: PlayRecord;
    }>(request);
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (hasDisallowedUserOverride(request, body)) {
      return NextResponse.json(
        { error: '不得指定其他使用者' },
        { status: 400 }
      );
    }
    const { key, record } = body;

    if (!key || !record) {
      return NextResponse.json(
        { error: 'Missing key or record' },
        { status: 400 }
      );
    }

    // 驗證播放記錄資料
    // 只檢查必要欄位與安全相關驗證，數值欄位改為「有值才驗證」
    // 以避免影片未載入時 (total_time=0) 觸發 400 錯誤
    if (
      !record.title ||
      !record.source_name ||
      !isValidApiTextParam(record.title) ||
      !isValidApiTextParam(record.source_name) ||
      typeof record.index !== 'number' ||
      !Number.isInteger(record.index) ||
      record.index < 1 ||
      (record.total_episodes !== undefined &&
        (!Number.isInteger(record.total_episodes) ||
          record.total_episodes < 1)) ||
      (record.play_time !== undefined &&
        (!Number.isFinite(record.play_time) || record.play_time < 0)) ||
      (record.total_time !== undefined &&
        (!Number.isFinite(record.total_time) || record.total_time < 0)) ||
      (record.play_time !== undefined &&
        record.total_time !== undefined &&
        record.total_time > 0 &&
        record.play_time > record.total_time + 5) ||
      (record.save_time !== undefined &&
        (!Number.isFinite(record.save_time) || record.save_time <= 0))
    ) {
      return NextResponse.json(
        { error: 'Invalid record data' },
        { status: 400 }
      );
    }

    // 從key中解析source和id
    const parsedKey = parseAndValidateApiStorageKey(key);
    if (!parsedKey) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 }
      );
    }
    const { source, id } = parsedKey;

    const finalRecord = {
      ...record,
      save_time: record.save_time ?? Date.now(),
    } as PlayRecord;

    await db.savePlayRecord(username, source, id, finalRecord);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('儲存播放記錄失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const activeUser = await requireActiveUser(request);
    if (!activeUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = activeUser.username;
    if (hasDisallowedUserOverride(request)) {
      return NextResponse.json(
        { error: '不得指定其他使用者' },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    const title = searchParams.get('title') || undefined;
    const sourceName = searchParams.get('source_name') || undefined;

    if (
      (title && !isValidApiTextParam(title)) ||
      (sourceName && !isValidApiTextParam(sourceName))
    ) {
      return NextResponse.json(
        { error: 'Invalid query parameter' },
        { status: 400 }
      );
    }

    if (key) {
      // 如果提供了 key，刪除單條播放記錄
      const parsedKey = parseAndValidateApiStorageKey(key);
      if (!parsedKey) {
        return NextResponse.json(
          { error: 'Invalid key format' },
          { status: 400 }
        );
      }
      const { source, id } = parsedKey;

      await db.deletePlayRecord(username, source, id, { title, sourceName });
    } else {
      // 未提供 key，則清空全部播放記錄
      await db.deleteAllPlayRecords(username);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('刪除播放記錄失敗', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
