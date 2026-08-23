/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';
import { gunzip } from 'zlib';

import { AdminConfig } from '@/lib/admin.types';
import { requireOwner } from '@/lib/api-auth';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { configSelfCheck, getConfig, setCachedConfig } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { isHashed } from '@/lib/password';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { revokeUserSessions } from '@/lib/security-store';
import { parseStorageKey } from '@/lib/storage-key';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

const MAX_ENCRYPTED_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_ENCRYPTED_FILE_BYTES + 1024 * 1024;

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
    throw new Error(`目前的儲存後端無法還原使用者 ${username} 的雜湊密碼`);
  }

  await client.set(`u:${username}:pwd`, password);
  if (typeof client.sAdd === 'function') {
    await client.sAdd('sys:users', username);
  } else if (typeof client.sadd === 'function') {
    await client.sadd('sys:users', username);
  }
}

async function backupExistingData(): Promise<{
  adminConfig: any;
  userBackups: Record<
    string,
    {
      playRecords: Record<string, any>;
      favorites: Record<string, any>;
      searchHistory: string[];
      skipConfigs: Record<string, any>;
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
      searchHistory: string[];
      skipConfigs: Record<string, any>;
      password?: string;
    }
  > = {};

  const persistedUsers = await db.getAllUsers();
  const configuredUsers = adminConfig.UserConfig.Users.map(
    (user: { username: string }) => user.username
  );
  const users = Array.from(
    new Set(
      [...persistedUsers, ...configuredUsers, process.env.USERNAME].filter(
        Boolean
      )
    )
  ) as string[];

  for (const username of users) {
    const playRecords = await db.getAllPlayRecords(username);
    const favorites = await db.getAllFavorites(username);
    const searchHistory = await db.getSearchHistory(username);
    const skipConfigs = await db.getAllSkipConfigs(username);
    let password: string | undefined;
    if (username !== process.env.USERNAME) {
      const storageClient = (db as any).storage?.client;
      if (!storageClient || typeof storageClient.get !== 'function') {
        throw new Error(`無法備份使用者 ${username} 的登入資料`);
      }
      const storedPassword = await storageClient.get(`u:${username}:pwd`);
      if (!storedPassword) {
        throw new Error(`無法備份使用者 ${username} 的登入資料`);
      }
      password = String(storedPassword);
    }
    userBackups[username] = {
      playRecords,
      favorites,
      searchHistory,
      skipConfigs,
      ...(password ? { password } : {}),
    };
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
      searchHistory: string[];
      skipConfigs: Record<string, any>;
      password?: string;
    }
  >;
}): Promise<void> {
  await db.withAdminConfigLock(async () => {
    await db.saveAdminConfig(backup.adminConfig);
    await setCachedConfig(backup.adminConfig);
  });

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
    for (const keyword of [...userData.searchHistory].reverse()) {
      await db.addSearchHistory(username, keyword);
    }
    for (const [key, skipConfig] of Object.entries(userData.skipConfigs)) {
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

async function clearDataForUsers(usernames: Iterable<string>): Promise<void> {
  for (const username of new Set(Array.from(usernames).filter(Boolean))) {
    await db.deleteUser(username);
  }
  await db.clearAllData();
}

/**
 * 匯入成功後撤銷 session。必須用 revokeUserSessions（bump version），
 * 不可只刪 session key：getSessionVersion 讀不到會 NX 寫回 1，
 * 舊 cookie 的 version 也是 1，照樣 match。
 */
async function revokeSessionsForUsernames(
  usernames: Iterable<string | undefined | null>
): Promise<void> {
  const unique = new Set(
    Array.from(usernames).filter(
      (name): name is string => typeof name === 'string' && name.length > 0
    )
  );
  for (const username of unique) {
    await revokeUserSessions(username);
  }
}

export async function POST(req: NextRequest) {
  const crossSite = rejectCrossSiteRequest(req);
  if (crossSite) return crossSite;

  try {
    // 檢查存儲類型
    const storageType = getServerStorageType();
    if (storageType === 'localstorage') {
      return NextResponse.json(
        { error: '不支援本地存儲進行數據遷移' },
        { status: 400 }
      );
    }

    const owner = await requireOwner(req);
    if (!owner) {
      return NextResponse.json(
        { error: '權限不足，只有站長可以導入數據' },
        { status: 401 }
      );
    }

    const limited = await enforceRateLimit(req, {
      namespace: 'admin-migration',
      limit: 5,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const contentLength = Number(req.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_MULTIPART_BYTES) {
      return NextResponse.json(
        { error: '備份檔案過大，最大允許 20 MB' },
        { status: 413 }
      );
    }

    // 解析表單資料
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;

    if (!file) {
      return NextResponse.json({ error: '請選擇備份檔案' }, { status: 400 });
    }

    if (file.size > MAX_ENCRYPTED_FILE_BYTES) {
      return NextResponse.json(
        { error: '備份檔案過大，最大允許 20 MB' },
        { status: 413 }
      );
    }

    if (!password) {
      return NextResponse.json({ error: '請提供解密密碼' }, { status: 400 });
    }

    // 读取檔案内容
    const encryptedData = await file.text();

    // 解密数据
    let decryptedData: string;
    try {
      decryptedData = SimpleCrypto.decrypt(encryptedData, password);
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error && error.message.startsWith('解密失敗')
              ? error.message
              : '解密失敗：密碼不正確，或備份格式無法辨識',
        },
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
      return NextResponse.json({ error: '備份檔案格式錯誤' }, { status: 400 });
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
      return NextResponse.json({ error: '備份檔案格式無效' }, { status: 400 });
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

    if (
      typeof validImportData.data.adminConfig !== 'object' ||
      validImportData.data.adminConfig === null ||
      Array.isArray(validImportData.data.adminConfig) ||
      typeof validImportData.data.adminConfig.SiteConfig !== 'object' ||
      validImportData.data.adminConfig.SiteConfig === null ||
      typeof validImportData.data.adminConfig.UserConfig !== 'object' ||
      validImportData.data.adminConfig.UserConfig === null ||
      !Array.isArray(validImportData.data.adminConfig.UserConfig.Users) ||
      !Array.isArray(validImportData.data.adminConfig.SourceConfig) ||
      !Array.isArray(validImportData.data.adminConfig.CustomCategories) ||
      (validImportData.data.adminConfig.LiveConfig !== undefined &&
        !Array.isArray(validImportData.data.adminConfig.LiveConfig)) ||
      typeof validImportData.data.userData !== 'object' ||
      validImportData.data.userData === null ||
      Array.isArray(validImportData.data.userData)
    ) {
      return NextResponse.json({ error: '備份檔案格式無效' }, { status: 400 });
    }

    let importedAdminConfig: AdminConfig;
    try {
      importedAdminConfig = configSelfCheck(validImportData.data.adminConfig);
    } catch {
      return NextResponse.json(
        { error: '備份檔案中的管理設定無效' },
        { status: 400 }
      );
    }

    const userData = validImportData.data.userData;
    const ownerUsername = process.env.USERNAME;
    const configuredUsers = new Set(
      importedAdminConfig.UserConfig.Users.map((user) => user.username)
    );

    for (const [username, rawUser] of Object.entries(userData)) {
      if (
        !username.trim() ||
        typeof rawUser !== 'object' ||
        rawUser === null ||
        Array.isArray(rawUser)
      ) {
        return NextResponse.json(
          { error: '備份檔案中的使用者資料無效' },
          { status: 400 }
        );
      }
      if (
        username !== ownerUsername &&
        (typeof rawUser.password !== 'string' || !rawUser.password)
      ) {
        return NextResponse.json(
          { error: `使用者 ${username} 缺少登入資料` },
          { status: 400 }
        );
      }
      if (username !== ownerUsername && !configuredUsers.has(username)) {
        importedAdminConfig.UserConfig.Users.push({
          username,
          role: 'user',
          banned: false,
        });
        configuredUsers.add(username);
      }
    }

    for (const username of configuredUsers) {
      if (username === ownerUsername) continue;
      const user = userData[username];
      if (!user || typeof user.password !== 'string' || !user.password) {
        return NextResponse.json(
          { error: `使用者 ${username} 缺少登入資料` },
          { status: 400 }
        );
      }
    }

    // 備份現有資料，以便匯入失敗時回滾
    const backup = await backupExistingData();

    try {
      // 所有可能失敗的破壞性步驟都必須位於同一個回滾邊界內。
      await clearDataForUsers(Object.keys(backup.userBackups));
      await db.withAdminConfigLock(async () => {
        await db.saveAdminConfig(importedAdminConfig);
        await setCachedConfig(importedAdminConfig);
      });

      // 導入使用者數據
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

        // 導入跳過片頭片尾設定
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
        await clearDataForUsers([
          ...Object.keys(backup.userBackups),
          ...Object.keys(userData),
          ...importedAdminConfig.UserConfig.Users.map((user) => user.username),
        ]);
        await restoreBackup(backup);
        console.error('備份已成功還原');
        // 回滾成功：不 revoke——舊資料回來了，舊 cookie 仍應有效
        return NextResponse.json(
          { error: '導入中途失敗，已還原為匯入前的資料' },
          { status: 500 }
        );
      } catch (restoreErr) {
        console.error('備份還原也失敗了:', restoreErr);
        return NextResponse.json(
          { error: '導入失敗且備份還原失敗，請使用備份檔案重新導入' },
          { status: 500 }
        );
      }
    }

    // 資料已換成匯入內容（密碼／紀錄可能全變）：bump 一般使用者 session。
    // 不撤銷站長：密碼來自環境變數、匯入改不到；撤銷只會讓成功後的
    //「重新整理」撞 401，買不到安全性。
    // clearAllData / deleteUser 都不碰 security:session-version:*。
    await revokeSessionsForUsernames(
      [
        ...Object.keys(backup.userBackups),
        ...Object.keys(userData),
        ...importedAdminConfig.UserConfig.Users.map((user) => user.username),
      ].filter((name) => name !== ownerUsername)
    );

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
