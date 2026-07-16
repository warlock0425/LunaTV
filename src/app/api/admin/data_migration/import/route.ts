/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { gunzip } from 'zlib';

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie } from '@/lib/auth';
import { configSelfCheck, getConfig, setCachedConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { isHashed } from '@/lib/password';
import { parseStorageKey } from '@/lib/storage-key';

export const runtime = 'nodejs';

const MAX_ENCRYPTED_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

function gunzipWithLimit(data: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gunzip(
      data,
      { maxOutputLength: MAX_DECOMPRESSED_BYTES },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
  });
}

async function restoreUserPassword(username: string, password: string) {
  if (!isHashed(password)) {
    await db.registerUser(username, password);
    return;
  }

  const storage = (db as any).storage;
  const client = storage?.client;
  if (!client || typeof client.set !== 'function') {
    await db.registerUser(username, password);
    return;
  }

  await client.set(`u:${username}:pwd`, password);
  if (typeof client.sAdd === 'function') {
    await client.sAdd('users', username);
  } else if (typeof client.sadd === 'function') {
    await client.sadd('users', username);
  }
}

async function backupExistingData(): Promise<{
  adminConfig: any;
  userBackups: Record<
    string,
    {
      playRecords: Record<string, any>;
      favorites: Record<string, any>;
      password?: string;
    }
  >;
}> {
  const adminConfig = await getConfig();
  const userBackups: Record<
    string,
    {
      playRecords: Record<string, any>;
      favorites: Record<string, any>;
      password?: string;
    }
  > = {};

  const users = await db.getAllUsers();
  if (process.env.USERNAME && !users.includes(process.env.USERNAME)) {
    users.push(process.env.USERNAME);
  }

  for (const username of users) {
    try {
      const playRecords = await db.getAllPlayRecords(username);
      const favorites = await db.getAllFavorites(username);
      let password: string | undefined;
      try {
        const storageClient = (db as any).storage?.client;
        if (storageClient && typeof storageClient.get === 'function') {
          password =
            (await storageClient.get(`u:${username}:pwd`)) || undefined;
        }
      } catch {
        // 無法讀取密碼不中斷備份
      }
      userBackups[username] = {
        playRecords,
        favorites,
        ...(password ? { password } : {}),
      };
    } catch {
      // 備份單個使用者失敗不中斷整體
    }
  }

  return { adminConfig, userBackups };
}

async function restoreBackup(backup: {
  adminConfig: any;
  userBackups: Record<
    string,
    {
      playRecords: Record<string, any>;
      favorites: Record<string, any>;
      password?: string;
    }
  >;
}): Promise<void> {
  await db.saveAdminConfig(backup.adminConfig);
  await setCachedConfig(backup.adminConfig);

  for (const [username, userData] of Object.entries(backup.userBackups)) {
    if (userData.password) {
      await restoreUserPassword(username, userData.password);
    }
    for (const [key, record] of Object.entries(userData.playRecords)) {
      await (db as any).storage.setPlayRecord(username, key, record);
    }
    for (const [key, favorite] of Object.entries(userData.favorites)) {
      await (db as any).storage.setFavorite(username, key, favorite);
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    // 檢查存儲類型
    const storageType =
      process.env.STORAGE_TYPE ||
      process.env.NEXT_PUBLIC_STORAGE_TYPE ||
      'localstorage';
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支持本地存儲進行數據遷移' },
        { status: 400 }
      );
    }

    // 驗證身份和權限
    const authInfo = getAuthInfoFromCookie(req);
    if (!authInfo || !authInfo.username) {
      return NextResponse.json({ error: '未登錄' }, { status: 401 });
    }

    // 檢查使用者權限（只有站長可以匯入資料）
    if (authInfo.username !== process.env.USERNAME) {
      return NextResponse.json(
        { error: '權限不足，只有站長可以導入數據' },
        { status: 401 }
      );
    }

    // 解析表單資料
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;

    if (!file) {
      return NextResponse.json({ error: '請選擇備份文件' }, { status: 400 });
    }

    if (file.size > MAX_ENCRYPTED_FILE_BYTES) {
      return NextResponse.json(
        { error: '備份文件過大，最大允許 20 MB' },
        { status: 413 }
      );
    }

    if (!password) {
      return NextResponse.json({ error: '請提供解密密碼' }, { status: 400 });
    }

    // 读取文件内容
    const encryptedData = await file.text();

    // 解密数据
    let decryptedData: string;
    try {
      decryptedData = SimpleCrypto.decrypt(encryptedData, password);
    } catch (error) {
      return NextResponse.json(
        { error: '解密失敗，請檢查密碼是否正確' },
        { status: 400 }
      );
    }

    // 解压缩数据
    const compressedBuffer = Buffer.from(decryptedData, 'base64');
    if (compressedBuffer.length > MAX_ENCRYPTED_FILE_BYTES) {
      return NextResponse.json({ error: '壓縮資料過大' }, { status: 413 });
    }
    let decompressedBuffer: Buffer;
    try {
      decompressedBuffer = await gunzipWithLimit(compressedBuffer);
    } catch (error) {
      return NextResponse.json(
        { error: '備份資料解壓縮失敗或解壓後超過 50 MB' },
        { status: 400 }
      );
    }
    const decompressedData = decompressedBuffer.toString();

    // 解析JSON數據
    let importData: unknown;
    try {
      importData = JSON.parse(decompressedData);
    } catch (error) {
      return NextResponse.json({ error: '備份文件格式錯誤' }, { status: 400 });
    }

    // 驗證數據格式
    if (
      typeof importData !== 'object' ||
      importData === null ||
      !('data' in importData) ||
      typeof (importData as Record<string, unknown>).data !== 'object' ||
      (importData as Record<string, unknown>).data === null ||
      !(
        'adminConfig' in
        ((importData as Record<string, unknown>).data as Record<
          string,
          unknown
        >)
      ) ||
      !(
        'userData' in
        ((importData as Record<string, unknown>).data as Record<
          string,
          unknown
        >)
      )
    ) {
      return NextResponse.json({ error: '備份文件格式無效' }, { status: 400 });
    }

    const validImportData = importData as {
      data: {
        adminConfig: AdminConfig;
        userData: Record<
          string,
          {
            password?: string;
            playRecords?: Record<string, unknown>;
            favorites?: Record<string, unknown>;
            skipConfigs?: Record<string, unknown>;
            searchHistory?: string[];
          }
        >;
      };
      timestamp?: number;
      serverVersion?: string;
    };

    // 備份現有資料，以便匯入失敗時回滾
    const backup = await backupExistingData();

    // 開始導入數據 - 先清空現有數據
    await db.clearAllData();

    // 導入管理員配置
    validImportData.data.adminConfig = configSelfCheck(
      validImportData.data.adminConfig
    );
    await db.saveAdminConfig(validImportData.data.adminConfig);
    await setCachedConfig(validImportData.data.adminConfig);

    // 導入使用者數據
    const userData = validImportData.data.userData;
    try {
      for (const username in userData) {
        const user = userData[username];

        // 重新註冊使用者（包含密碼）
        if (user.password) {
          await restoreUserPassword(username, user.password);
        }

        // 導入播放記錄
        if (user.playRecords) {
          for (const [key, record] of Object.entries(user.playRecords)) {
            await (db as any).storage.setPlayRecord(username, key, record);
          }
        }

        // 導入收藏夾
        if (user.favorites) {
          for (const [key, favorite] of Object.entries(user.favorites)) {
            await (db as any).storage.setFavorite(username, key, favorite);
          }
        }

        // 導入搜索歷史
        if (user.searchHistory && Array.isArray(user.searchHistory)) {
          for (const keyword of [...user.searchHistory].reverse()) {
            // 反轉以保持順序
            await db.addSearchHistory(username, keyword);
          }
        }

        // 導入跳過片頭片尾配置
        if (user.skipConfigs) {
          for (const [key, skipConfig] of Object.entries(user.skipConfigs)) {
            const parsedKey = parseStorageKey(key);
            if (parsedKey) {
              await db.setSkipConfig(
                username,
                parsedKey.source,
                parsedKey.id,
                skipConfig as any
              );
            }
          }
        }
      }
    } catch (importErr) {
      // 匯入中途失敗，嘗試還原備份
      console.error('數據導入中途失敗，嘗試還原備份:', importErr);
      try {
        await db.clearAllData();
        await restoreBackup(backup);
        console.error('備份已成功還原');
        return NextResponse.json(
          { error: '導入中途失敗，已還原為匯入前的資料' },
          { status: 500 }
        );
      } catch (restoreErr) {
        console.error('備份還原也失敗了:', restoreErr);
        return NextResponse.json(
          { error: '導入失敗且備份還原失敗，請使用備份文件重新導入' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      message: '數據導入成功',
      importedUsers: Object.keys(userData).length,
      timestamp: validImportData.timestamp,
      serverVersion:
        typeof validImportData.serverVersion === 'string'
          ? validImportData.serverVersion
          : '未知版本',
    });
  } catch (error) {
    console.error('數據導入失敗:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '導入失敗' },
      { status: 500 }
    );
  }
}
