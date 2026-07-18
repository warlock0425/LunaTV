/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import {
  isValidApiMediaId,
  isValidApiSource,
  parseAndValidateApiStorageKey,
  readJsonObject,
} from '@/lib/api-input-validation';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { SkipConfig } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const config = await getConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查使用者存在或被封禁
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
    const source = searchParams.get('source');
    const id = searchParams.get('id');

    if (source && id) {
      if (!isValidApiSource(source) || !isValidApiMediaId(id)) {
        return NextResponse.json(
          { error: 'Invalid query parameter' },
          { status: 400 }
        );
      }

      // 獲取單個配置
      const skipConfig = await db.getSkipConfig(authInfo.username, source, id);
      return NextResponse.json(skipConfig);
    } else {
      // 獲取所有配置
      const configs = await db.getAllSkipConfigs(authInfo.username);
      return NextResponse.json(configs);
    }
  } catch (error) {
    console.error('获取跳过片头片尾配置失敗:', error);
    return NextResponse.json(
      { error: '獲取跳過片頭片尾配置失敗' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const adminConfig = await getConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查使用者存在或被封禁
      const user = adminConfig.UserConfig.Users.find(
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
      key?: unknown;
      config?: Record<string, unknown>;
    }>(request);
    if (!body) {
      return NextResponse.json({ error: '請求格式錯誤' }, { status: 400 });
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

    await db.setSkipConfig(authInfo.username, source, id, skipConfig);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('儲存跳過片頭片尾配置失敗:', error);
    return NextResponse.json(
      { error: '儲存跳過片頭片尾配置失敗' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authInfo = getAuthInfoFromCookie(request);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const adminConfig = await getConfig();
    if (authInfo.username !== process.env.USERNAME) {
      // 非站长，检查使用者存在或被封禁
      const user = adminConfig.UserConfig.Users.find(
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

    if (!key) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    const parsedKey = parseAndValidateApiStorageKey(key);
    if (!parsedKey) {
      return NextResponse.json({ error: '無效的key格式' }, { status: 400 });
    }
    const { source, id } = parsedKey;

    await db.deleteSkipConfig(authInfo.username, source, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('刪除跳過片頭片尾配置失敗:', error);
    return NextResponse.json(
      { error: '刪除跳過片頭片尾配置失敗' },
      { status: 500 }
    );
  }
}
