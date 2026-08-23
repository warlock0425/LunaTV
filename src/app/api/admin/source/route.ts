/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import {
  isValidApiRemoteUrl,
  isValidApiSource,
  isValidApiTextParam,
  readJsonObject,
} from '@/lib/api-input-validation';
import { getFreshConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

// 支援的操作類型
type Action =
  | 'add'
  | 'disable'
  | 'enable'
  | 'delete'
  | 'sort'
  | 'batch_disable'
  | 'batch_enable'
  | 'batch_delete';

interface BaseBody {
  action?: Action;
}

function isValidSourceKey(value: unknown): value is string {
  return isValidApiSource(value) && !value.includes('+');
}

function isValidSourceKeyList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isValidSourceKey(item))
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
    if (!(await requireAdmin(request))) {
      return NextResponse.json({ error: '權限不足' }, { status: 401 });
    }

    const body = await readJsonObject<BaseBody & Record<string, any>>(request);
    if (!body) {
      return NextResponse.json(
        { error: '請提供有效的 JSON 物件' },
        { status: 400 }
      );
    }
    const { action } = body;

    // 基礎校驗
    const ACTIONS: Action[] = [
      'add',
      'disable',
      'enable',
      'delete',
      'sort',
      'batch_disable',
      'batch_enable',
      'batch_delete',
    ];
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    const outcome = await db.withAdminConfigLock(
      async (): Promise<NextResponse | 'ok'> => {
        // 鎖內重讀設定
        const adminConfig = await getFreshConfig();

        switch (action) {
          case 'add': {
            const { key, name, api, detail } = body as {
              key?: string;
              name?: string;
              api?: string;
              detail?: string;
            };
            if (!key || !name || !api) {
              return NextResponse.json(
                { error: '缺少必要參數' },
                { status: 400 }
              );
            }
            if (
              !isValidSourceKey(key) ||
              !isValidApiTextParam(name, 200) ||
              !isValidApiRemoteUrl(api) ||
              (detail !== undefined &&
                (typeof detail !== 'string' ||
                  (detail.trim() !== '' && !isValidApiRemoteUrl(detail))))
            ) {
              return NextResponse.json(
                { error: '來源參數格式不合法' },
                { status: 400 }
              );
            }
            if (adminConfig.SourceConfig.some((s) => s.key === key)) {
              return NextResponse.json(
                { error: '該源已存在' },
                { status: 400 }
              );
            }
            adminConfig.SourceConfig.push({
              key: key.trim(),
              name: name.trim(),
              api: api.trim(),
              detail: detail?.trim() || undefined,
              from: 'custom',
              disabled: false,
            });
            break;
          }
          case 'disable': {
            const { key } = body as { key?: string };
            if (!isValidSourceKey(key))
              return NextResponse.json(
                { error: '缺少 key 參數' },
                { status: 400 }
              );
            const entry = adminConfig.SourceConfig.find((s) => s.key === key);
            if (!entry)
              return NextResponse.json({ error: '源不存在' }, { status: 404 });
            entry.disabled = true;
            break;
          }
          case 'enable': {
            const { key } = body as { key?: string };
            if (!isValidSourceKey(key))
              return NextResponse.json(
                { error: '缺少 key 參數' },
                { status: 400 }
              );
            const entry = adminConfig.SourceConfig.find((s) => s.key === key);
            if (!entry)
              return NextResponse.json({ error: '源不存在' }, { status: 404 });
            entry.disabled = false;
            break;
          }
          case 'delete': {
            const { key } = body as { key?: string };
            if (!isValidSourceKey(key))
              return NextResponse.json(
                { error: '缺少 key 參數' },
                { status: 400 }
              );
            const idx = adminConfig.SourceConfig.findIndex(
              (s) => s.key === key
            );
            if (idx === -1)
              return NextResponse.json({ error: '源不存在' }, { status: 404 });
            const entry = adminConfig.SourceConfig[idx];
            if (entry.from === 'config') {
              return NextResponse.json(
                { error: '該源不可刪除' },
                { status: 400 }
              );
            }
            adminConfig.SourceConfig.splice(idx, 1);

            // 檢查並清理使用者群組和使用者的權限陣列
            // 清理使用者群組權限
            if (adminConfig.UserConfig.Tags) {
              adminConfig.UserConfig.Tags.forEach((tag) => {
                if (tag.enabledApis) {
                  tag.enabledApis = tag.enabledApis.filter(
                    (api) => api !== key
                  );
                }
              });
            }

            // 清理使用者權限
            adminConfig.UserConfig.Users.forEach((user) => {
              if (user.enabledApis) {
                user.enabledApis = user.enabledApis.filter(
                  (api) => api !== key
                );
              }
            });
            break;
          }
          case 'batch_disable': {
            const { keys } = body as { keys?: string[] };
            if (!isValidSourceKeyList(keys)) {
              return NextResponse.json(
                { error: '缺少 keys 參數或為空' },
                { status: 400 }
              );
            }
            keys.forEach((key) => {
              const entry = adminConfig.SourceConfig.find((s) => s.key === key);
              if (entry) {
                entry.disabled = true;
              }
            });
            break;
          }
          case 'batch_enable': {
            const { keys } = body as { keys?: string[] };
            if (!isValidSourceKeyList(keys)) {
              return NextResponse.json(
                { error: '缺少 keys 參數或為空' },
                { status: 400 }
              );
            }
            keys.forEach((key) => {
              const entry = adminConfig.SourceConfig.find((s) => s.key === key);
              if (entry) {
                entry.disabled = false;
              }
            });
            break;
          }
          case 'batch_delete': {
            const { keys } = body as { keys?: string[] };
            if (!isValidSourceKeyList(keys)) {
              return NextResponse.json(
                { error: '缺少 keys 參數或為空' },
                { status: 400 }
              );
            }
            // 過濾掉 from=config 的源，但不報錯
            const keysToDelete = keys.filter((key) => {
              const entry = adminConfig.SourceConfig.find((s) => s.key === key);
              return entry && entry.from !== 'config';
            });

            // 批量刪除
            keysToDelete.forEach((key) => {
              const idx = adminConfig.SourceConfig.findIndex(
                (s) => s.key === key
              );
              if (idx !== -1) {
                adminConfig.SourceConfig.splice(idx, 1);
              }
            });

            // 檢查並清理使用者群組和使用者的權限數組
            if (keysToDelete.length > 0) {
              // 清理使用者群組權限
              if (adminConfig.UserConfig.Tags) {
                adminConfig.UserConfig.Tags.forEach((tag) => {
                  if (tag.enabledApis) {
                    tag.enabledApis = tag.enabledApis.filter(
                      (api) => !keysToDelete.includes(api)
                    );
                  }
                });
              }

              // 清理使用者權限
              adminConfig.UserConfig.Users.forEach((user) => {
                if (user.enabledApis) {
                  user.enabledApis = user.enabledApis.filter(
                    (api) => !keysToDelete.includes(api)
                  );
                }
              });
            }
            break;
          }
          case 'sort': {
            const { order } = body as { order?: string[] };
            if (
              !Array.isArray(order) ||
              !order.every((item) => isValidSourceKey(item))
            ) {
              return NextResponse.json(
                { error: '排序列表格式錯誤' },
                { status: 400 }
              );
            }
            const map = new Map(
              adminConfig.SourceConfig.map((s) => [s.key, s])
            );
            const newList: typeof adminConfig.SourceConfig = [];
            order.forEach((k) => {
              const item = map.get(k);
              if (item) {
                newList.push(item);
                map.delete(k);
              }
            });
            // 未在 order 中的保持原顺序
            adminConfig.SourceConfig.forEach((item) => {
              if (map.has(item.key)) newList.push(item);
            });
            adminConfig.SourceConfig = newList;
            break;
          }
          default:
            return NextResponse.json({ error: '未知操作' }, { status: 400 });
        }

        // 持久化到儲存
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
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    console.error('影片源管理操作失敗:', error);
    return NextResponse.json(
      {
        error: '影片源管理操作失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
