/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import {
  hasControlChars,
  isValidApiSource,
  isValidApiTextParam,
  readJsonObject,
} from '@/lib/api-input-validation';
import { getFreshConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { revokeUserSessions } from '@/lib/security-store';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

// 支援的操作類型
const ACTIONS = [
  'add',
  'ban',
  'unban',
  'setAdmin',
  'cancelAdmin',
  'changePassword',
  'deleteUser',
  'updateUserApis',
  'userGroup',
  'updateUserGroups',
  'batchUpdateUserGroups',
] as const;

function isValidApiList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isValidApiSource(item));
}

function isValidTextList(value: unknown, maxLength = 128): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isValidApiTextParam(item, maxLength))
  );
}

/**
 * 新帳號的使用者名格式。
 *
 * 只擋真正會出事的字元，不用白名單——本專案面向繁中使用者，中文帳號是合理
 * 需求，Redis 鍵本身也是二進位安全的：
 *   - 冒號：使用者名會直接組成儲存鍵（u:<name>:pwd），帳號 `a:pwd` 會產生
 *     `u:a:pwd:pwd`，被名冊掃描的 /^u:(.+?):pwd$/ 非貪婪解析成不存在的帳號 `a`。
 *   - 空白與控制字元：`alice` 與 `alice ` 會變成兩個難以分辨的帳號。
 *   - 長度：避免鍵無限膨脹。
 *
 * 僅套用在「新增」，不驗證既有帳號，避免升級後舊帳號被鎖在門外。
 */
const MAX_USERNAME_LENGTH = 64;
const MAX_PASSWORD_LENGTH = 128;

function isValidNewUsername(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_USERNAME_LENGTH &&
    !value.includes(':') &&
    !/\s/.test(value) &&
    !hasControlChars(value)
  );
}

function isValidNewPassword(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_PASSWORD_LENGTH
  );
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支援本地儲存進行管理員設定',
      },
      { status: 400 }
    );
  }

  try {
    const body = await readJsonObject(request);
    if (!body) {
      return NextResponse.json(
        { error: '請提供有效的 JSON 物件' },
        { status: 400 }
      );
    }

    const operator = await requireAdmin(request);
    if (!operator) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const username = operator.username;

    const {
      targetUsername, // 目標使用者名
      targetPassword, // 目標使用者密碼（僅在新增使用者時需要）
      action,
    } = body as {
      targetUsername?: string;
      targetPassword?: string;
      action?: (typeof ACTIONS)[number];
    };

    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    // 使用者群組操作和批量操作不需要targetUsername
    if (
      !targetUsername &&
      !['userGroup', 'batchUpdateUserGroups'].includes(action)
    ) {
      return NextResponse.json({ error: '缺少目標使用者名' }, { status: 400 });
    }

    if (
      action !== 'changePassword' &&
      action !== 'deleteUser' &&
      action !== 'updateUserApis' &&
      action !== 'userGroup' &&
      action !== 'updateUserGroups' &&
      action !== 'batchUpdateUserGroups' &&
      username === targetUsername
    ) {
      return NextResponse.json(
        { error: '無法對自己進行此操作' },
        { status: 400 }
      );
    }

    const outcome = await db.withAdminConfigLock(
      async (): Promise<NextResponse | 'ok'> => {
        // 鎖內重讀設定
        const adminConfig = await getFreshConfig();

        // 鎖內再確認角色，避免鎖外讀到的權限已被撤銷
        let operatorRole: 'owner' | 'admin';
        if (username === process.env.USERNAME) {
          operatorRole = 'owner';
        } else {
          const userEntry = adminConfig.UserConfig.Users.find(
            (u) => u.username === username
          );
          if (!userEntry || userEntry.role !== 'admin' || userEntry.banned) {
            return NextResponse.json({ error: '權限不足' }, { status: 401 });
          }
          operatorRole = 'admin';
        }

        // 查找目標使用者條目（使用者群組操作和批量操作不需要）
        let targetEntry: any = null;
        let isTargetAdmin = false;

        if (
          !['userGroup', 'batchUpdateUserGroups'].includes(action) &&
          targetUsername
        ) {
          targetEntry = adminConfig.UserConfig.Users.find(
            (u) => u.username === targetUsername
          );

          if (
            targetUsername === process.env.USERNAME ||
            targetEntry?.role === 'owner'
          ) {
            return NextResponse.json(
              { error: '無法操作站長' },
              { status: 403 }
            );
          }

          // 權限校驗邏輯
          isTargetAdmin = targetEntry?.role === 'admin';

          if (operatorRole === 'admin' && isTargetAdmin) {
            return NextResponse.json(
              { error: '管理員只能管理一般使用者' },
              { status: 403 }
            );
          }
        }

        switch (action) {
          case 'add': {
            if (targetEntry) {
              return NextResponse.json(
                { error: '使用者已存在' },
                { status: 400 }
              );
            }
            if (!isValidNewUsername(targetUsername)) {
              return NextResponse.json(
                {
                  error: `使用者名不可含冒號、空白或控制字元，長度 1～${MAX_USERNAME_LENGTH}`,
                },
                { status: 400 }
              );
            }
            if (!isValidNewPassword(targetPassword)) {
              return NextResponse.json(
                {
                  error: `密碼不得為空，且長度不可超過 ${MAX_PASSWORD_LENGTH}`,
                },
                { status: 400 }
              );
            }
            // 設定與資料庫可能不同步（例如帳號從設定移除但密碼鍵仍在），
            // 直接 registerUser 會覆蓋掉既有帳號的密碼。
            const requestedRole = (body as { role?: unknown }).role;
            if (requestedRole !== undefined && requestedRole !== 'user') {
              return NextResponse.json(
                {
                  error:
                    '新增帳號只能是一般使用者，請由站長使用 setAdmin 提升權限',
                },
                { status: 403 }
              );
            }
            if (await db.checkUserExist(targetUsername)) {
              return NextResponse.json(
                { error: '該使用者名已被使用' },
                { status: 400 }
              );
            }
            await db.registerUser(targetUsername, targetPassword);

            // 取得使用者群組資訊
            const { userGroup } = body as { userGroup?: string };

            // 更新設定。忽略 body.role，一律寫入一般使用者。
            const newUser: any = {
              username: targetUsername!,
              role: 'user',
            };

            // 如果指定了使用者群組，新增到tags中
            if (userGroup && userGroup.trim()) {
              newUser.tags = [userGroup];
            }

            adminConfig.UserConfig.Users.push(newUser);
            targetEntry =
              adminConfig.UserConfig.Users[
                adminConfig.UserConfig.Users.length - 1
              ];
            break;
          }
          case 'ban': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目標使用者不存在' },
                { status: 404 }
              );
            }
            if (isTargetAdmin) {
              // 目標是管理員
              if (operatorRole !== 'owner') {
                return NextResponse.json(
                  { error: '僅站長可封禁管理員' },
                  { status: 401 }
                );
              }
            }
            targetEntry.banned = true;
            await revokeUserSessions(targetUsername!);
            break;
          }
          case 'unban': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目標使用者不存在' },
                { status: 404 }
              );
            }
            if (isTargetAdmin) {
              if (operatorRole !== 'owner') {
                return NextResponse.json(
                  { error: '僅站長可操作管理員' },
                  { status: 401 }
                );
              }
            }
            targetEntry.banned = false;
            break;
          }
          case 'setAdmin': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目標使用者不存在' },
                { status: 404 }
              );
            }
            if (targetEntry.role === 'admin') {
              return NextResponse.json(
                { error: '該使用者已是管理員' },
                { status: 400 }
              );
            }
            if (operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '僅站長可設定管理員' },
                { status: 401 }
              );
            }
            targetEntry.role = 'admin';
            await revokeUserSessions(targetUsername!);
            break;
          }
          case 'cancelAdmin': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目標使用者不存在' },
                { status: 404 }
              );
            }
            if (targetEntry.role !== 'admin') {
              return NextResponse.json(
                { error: '目標使用者不是管理員' },
                { status: 400 }
              );
            }
            if (operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '僅站長可取消管理員' },
                { status: 401 }
              );
            }
            targetEntry.role = 'user';
            await revokeUserSessions(targetUsername!);
            break;
          }
          case 'changePassword': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目標使用者不存在' },
                { status: 404 }
              );
            }
            if (!isValidNewPassword(targetPassword)) {
              return NextResponse.json(
                {
                  error: `密碼不得為空，且長度不可超過 ${MAX_PASSWORD_LENGTH}`,
                },
                { status: 400 }
              );
            }

            // 權限檢查：不允許修改站長密碼
            if (targetEntry.role === 'owner') {
              return NextResponse.json(
                { error: '無法修改站長密碼' },
                { status: 401 }
              );
            }

            if (
              isTargetAdmin &&
              operatorRole !== 'owner' &&
              username !== targetUsername
            ) {
              return NextResponse.json(
                { error: '僅站長可修改其他管理員密碼' },
                { status: 401 }
              );
            }

            await db.changePassword(targetUsername!, targetPassword);
            await revokeUserSessions(targetUsername!);
            break;
          }
          case 'deleteUser': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目標使用者不存在' },
                { status: 404 }
              );
            }

            // 權限檢查：站長可刪除所有使用者（除了自己），管理員可刪除普通使用者
            if (username === targetUsername) {
              return NextResponse.json(
                { error: '不能刪除自己' },
                { status: 400 }
              );
            }

            if (isTargetAdmin && operatorRole !== 'owner') {
              return NextResponse.json(
                { error: '僅站長可刪除管理員' },
                { status: 401 }
              );
            }

            await db.deleteUser(targetUsername!);
            await revokeUserSessions(targetUsername!);

            // 從設定中移除使用者
            const userIndex = adminConfig.UserConfig.Users.findIndex(
              (u) => u.username === targetUsername
            );
            if (userIndex > -1) {
              adminConfig.UserConfig.Users.splice(userIndex, 1);
            }

            break;
          }
          case 'updateUserApis': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目標使用者不存在' },
                { status: 404 }
              );
            }

            const { enabledApis } = body as { enabledApis?: string[] };

            if (enabledApis !== undefined && !isValidApiList(enabledApis)) {
              return NextResponse.json(
                { error: 'enabledApis 格式不合法' },
                { status: 400 }
              );
            }

            // 權限檢查：站長可設定所有人的採集源，管理員可設定普通使用者和自己的採集源
            if (
              isTargetAdmin &&
              operatorRole !== 'owner' &&
              username !== targetUsername
            ) {
              return NextResponse.json(
                { error: '僅站長可設定其他管理員的採集源' },
                { status: 401 }
              );
            }

            // 更新使用者的採集源權限
            if (enabledApis && enabledApis.length > 0) {
              targetEntry.enabledApis = enabledApis;
            } else {
              // 如果為空數組或未提供，則刪除該字段，表示無限製
              delete targetEntry.enabledApis;
            }

            break;
          }
          case 'userGroup': {
            // 使用者群組管理操作
            const { groupAction, groupName, enabledApis } = body as {
              groupAction: 'add' | 'edit' | 'delete';
              groupName: string;
              enabledApis?: string[];
            };

            if (
              !['add', 'edit', 'delete'].includes(groupAction) ||
              !isValidApiTextParam(groupName, 128) ||
              (enabledApis !== undefined && !isValidApiList(enabledApis))
            ) {
              return NextResponse.json(
                { error: '使用者群組參數格式不合法' },
                { status: 400 }
              );
            }

            if (!adminConfig.UserConfig.Tags) {
              adminConfig.UserConfig.Tags = [];
            }

            switch (groupAction) {
              case 'add': {
                // 檢查使用者群組是否已存在
                if (
                  adminConfig.UserConfig.Tags.find((t) => t.name === groupName)
                ) {
                  return NextResponse.json(
                    { error: '使用者群組已存在' },
                    { status: 400 }
                  );
                }
                adminConfig.UserConfig.Tags.push({
                  name: groupName,
                  enabledApis: enabledApis || [],
                });
                break;
              }
              case 'edit': {
                const groupIndex = adminConfig.UserConfig.Tags.findIndex(
                  (t) => t.name === groupName
                );
                if (groupIndex === -1) {
                  return NextResponse.json(
                    { error: '使用者群組不存在' },
                    { status: 404 }
                  );
                }
                adminConfig.UserConfig.Tags[groupIndex].enabledApis =
                  enabledApis || [];
                break;
              }
              case 'delete': {
                const groupIndex = adminConfig.UserConfig.Tags.findIndex(
                  (t) => t.name === groupName
                );
                if (groupIndex === -1) {
                  return NextResponse.json(
                    { error: '使用者群組不存在' },
                    { status: 404 }
                  );
                }

                // 查找使用該使用者群組的所有使用者
                const affectedUsers: string[] = [];
                adminConfig.UserConfig.Users.forEach((user) => {
                  if (user.tags && user.tags.includes(groupName)) {
                    affectedUsers.push(user.username);
                    // 從使用者的tags中移除該使用者群組
                    user.tags = user.tags.filter((tag) => tag !== groupName);
                    // 如果使用者沒有其他標籤了，刪除tags字段
                    if (user.tags.length === 0) {
                      delete user.tags;
                    }
                  }
                });

                // 刪除使用者群組
                adminConfig.UserConfig.Tags.splice(groupIndex, 1);

                // 記錄刪除操作的影響
                console.log(
                  `刪除使用者群組 "${groupName}"，影響使用者: ${
                    affectedUsers.length > 0 ? affectedUsers.join(', ') : '無'
                  }`
                );

                break;
              }
              default:
                return NextResponse.json(
                  { error: '未知的使用者群組操作' },
                  { status: 400 }
                );
            }
            break;
          }
          case 'updateUserGroups': {
            if (!targetEntry) {
              return NextResponse.json(
                { error: '目標使用者不存在' },
                { status: 404 }
              );
            }

            const { userGroups } = body as { userGroups: string[] };

            if (!isValidTextList(userGroups)) {
              return NextResponse.json(
                { error: 'userGroups 格式不合法' },
                { status: 400 }
              );
            }

            // 權限檢查：站長可設定所有人的使用者群組，管理員可設定普通使用者和自己的使用者群組
            if (
              isTargetAdmin &&
              operatorRole !== 'owner' &&
              username !== targetUsername
            ) {
              return NextResponse.json(
                { error: '僅站長可設定其他管理員的使用者群組' },
                { status: 400 }
              );
            }

            // 更新使用者的使用者群組
            if (userGroups && userGroups.length > 0) {
              targetEntry.tags = userGroups;
            } else {
              // 如果為空數組或未提供，則刪除該字段，表示無使用者群組
              delete targetEntry.tags;
            }

            break;
          }
          case 'batchUpdateUserGroups': {
            const { usernames, userGroups } = body as {
              usernames: string[];
              userGroups: string[];
            };

            if (!isValidTextList(usernames) || usernames.length === 0) {
              return NextResponse.json(
                { error: '缺少使用者名列表' },
                { status: 400 }
              );
            }
            if (!isValidTextList(userGroups)) {
              return NextResponse.json(
                { error: 'userGroups 格式不合法' },
                { status: 400 }
              );
            }

            // 權限檢查：站長可批量設定所有人的使用者群組，管理員只能批量設定普通使用者
            if (operatorRole !== 'owner') {
              for (const name of usernames) {
                if (name === process.env.USERNAME) {
                  return NextResponse.json(
                    { error: '無法操作站長' },
                    { status: 403 }
                  );
                }
                const targetUser = adminConfig.UserConfig.Users.find(
                  (u) => u.username === name
                );
                if (targetUser && targetUser.role !== 'user') {
                  return NextResponse.json(
                    { error: '管理員只能管理一般使用者' },
                    { status: 403 }
                  );
                }
              }
            }

            // 批量更新使用者群組
            for (const targetUsername of usernames) {
              const targetUser = adminConfig.UserConfig.Users.find(
                (u) => u.username === targetUsername
              );
              if (targetUser) {
                if (userGroups && userGroups.length > 0) {
                  targetUser.tags = userGroups;
                } else {
                  // 如果為空數組或未提供，則刪除該字段，表示無使用者群組
                  delete targetUser.tags;
                }
              }
            }

            break;
          }
          default:
            return NextResponse.json({ error: '未知操作' }, { status: 400 });
        }

        // 將更新後的設定寫入資料庫
        await db.saveAdminConfig(adminConfig);
        setCachedConfig(adminConfig);
        return 'ok';
      }
    );

    if (outcome !== 'ok') return outcome;

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理員設定不快取
        },
      }
    );
  } catch (error) {
    console.error('使用者管理操作失敗:', error);
    return NextResponse.json(
      {
        error: '使用者管理操作失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
