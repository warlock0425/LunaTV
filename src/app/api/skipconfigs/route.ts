import { NextRequest, NextResponse } from 'next/server';

import { requireActiveUser } from '@/lib/api-auth';
import {
  hasDisallowedUserOverride,
  isValidApiMediaId,
  isValidApiSource,
  parseAndValidateApiStorageKey,
  readJsonObject,
} from '@/lib/api-input-validation';
import { db } from '@/lib/db';
import { SkipConfig } from '@/lib/types';

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

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');

    if (source && id) {
      if (!isValidApiSource(source) || !isValidApiMediaId(id)) {
        return NextResponse.json(
          { error: 'Invalid query parameter' },
          { status: 400 }
        );
      }

      // 取得單個設定
      const skipConfig = await db.getSkipConfig(username, source, id);
      return NextResponse.json(skipConfig);
    } else {
      // 取得所有設定
      const configs = await db.getAllSkipConfigs(username);
      return NextResponse.json(configs);
    }
  } catch (error) {
    console.error('取得跳過片頭片尾設定失敗:', error);
    return NextResponse.json(
      { error: '取得跳過片頭片尾設定失敗' },
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
      key?: unknown;
      config?: Record<string, unknown>;
    }>(request);
    if (!body) {
      return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
    }
    if (hasDisallowedUserOverride(request, body)) {
      return NextResponse.json(
        { error: '不得指定其他使用者' },
        { status: 400 }
      );
    }
    const { key, config } = body;

    if (
      !key ||
      !config ||
      typeof config !== 'object' ||
      Array.isArray(config)
    ) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    const parsedKey = parseAndValidateApiStorageKey(key);
    if (!parsedKey) {
      return NextResponse.json({ error: '無效的key格式' }, { status: 400 });
    }
    const { source, id } = parsedKey;

    const introTime = Number(config.intro_time);
    const outroTime = Number(config.outro_time);
    if (
      !Number.isFinite(introTime) ||
      !Number.isFinite(outroTime) ||
      introTime < 0 ||
      introTime > 6 * 60 * 60 ||
      outroTime < -6 * 60 * 60 ||
      outroTime > 0
    ) {
      return NextResponse.json({ error: '無效的跳過時間' }, { status: 400 });
    }

    const skipConfig: SkipConfig = {
      enable: Boolean(config.enable),
      intro_time: introTime,
      outro_time: outroTime,
    };

    await db.setSkipConfig(username, source, id, skipConfig);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('儲存跳過片頭片尾設定失敗:', error);
    return NextResponse.json(
      { error: '儲存跳過片頭片尾設定失敗' },
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

    if (!key) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    const parsedKey = parseAndValidateApiStorageKey(key);
    if (!parsedKey) {
      return NextResponse.json({ error: '無效的key格式' }, { status: 400 });
    }
    const { source, id } = parsedKey;

    await db.deleteSkipConfig(username, source, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('刪除跳過片頭片尾設定失敗:', error);
    return NextResponse.json(
      { error: '刪除跳過片頭片尾設定失敗' },
      { status: 500 }
    );
  }
}
