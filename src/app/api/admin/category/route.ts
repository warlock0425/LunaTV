/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import {
  isValidApiTextParam,
  readJsonObject,
} from '@/lib/api-input-validation';
import { getFreshConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { getServerStorageType } from '@/lib/storage-runtime';

export const runtime = 'nodejs';

// 支援的操作類型
type Action = 'add' | 'disable' | 'enable' | 'delete' | 'sort';

interface BaseBody {
  action?: Action;
}

function isCategoryType(value: unknown): value is 'movie' | 'tv' {
  return value === 'movie' || value === 'tv';
}

export async function POST(request: NextRequest) {
  const crossSite = rejectCrossSiteRequest(request);
  if (crossSite) return crossSite;

  const storageType = getServerStorageType();
  if (storageType === 'localstorage') {
    return NextResponse.json(
      {
        error: '不支援本地存儲進行管理員設定',
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
    const ACTIONS: Action[] = ['add', 'disable', 'enable', 'delete', 'sort'];
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: '參數格式錯誤' }, { status: 400 });
    }

    const outcome = await db.withAdminConfigLock(
      async (): Promise<NextResponse | 'ok'> => {
        // 鎖內重讀設定
        const adminConfig = await getFreshConfig();

        switch (action) {
          case 'add': {
            const { name, type, query } = body as {
              name?: string;
              type?: 'movie' | 'tv';
              query?: string;
            };
            if (!name || !type || !query) {
              return NextResponse.json(
                { error: '缺少必要參數' },
                { status: 400 }
              );
            }
            if (!isCategoryType(type)) {
              return NextResponse.json(
                { error: 'type 格式不合法' },
                { status: 400 }
              );
            }
            if (
              !isValidApiTextParam(name, 50) ||
              !isValidApiTextParam(query, 200)
            ) {
              return NextResponse.json(
                { error: '參數格式不合法' },
                { status: 400 }
              );
            }
            // 檢查是否已存在相同的查詢和類型組合
            if (
              adminConfig.CustomCategories.some(
                (c) => c.query === query && c.type === type
              )
            ) {
              return NextResponse.json(
                { error: '該分類已存在' },
                { status: 400 }
              );
            }
            adminConfig.CustomCategories.push({
              name,
              type,
              query,
              from: 'custom',
              disabled: false,
            });
            break;
          }
          case 'disable': {
            const { query, type } = body as {
              query?: string;
              type?: 'movie' | 'tv';
            };
            if (!query || !type)
              return NextResponse.json(
                { error: '缺少 query 或 type 參數' },
                { status: 400 }
              );
            if (!isCategoryType(type))
              return NextResponse.json(
                { error: 'type 格式不合法' },
                { status: 400 }
              );
            if (!isValidApiTextParam(query, 200))
              return NextResponse.json(
                { error: 'query 格式不合法' },
                { status: 400 }
              );
            const entry = adminConfig.CustomCategories.find(
              (c) => c.query === query && c.type === type
            );
            if (!entry)
              return NextResponse.json(
                { error: '分類不存在' },
                { status: 404 }
              );
            entry.disabled = true;
            break;
          }
          case 'enable': {
            const { query, type } = body as {
              query?: string;
              type?: 'movie' | 'tv';
            };
            if (!query || !type)
              return NextResponse.json(
                { error: '缺少 query 或 type 參數' },
                { status: 400 }
              );
            if (!isCategoryType(type))
              return NextResponse.json(
                { error: 'type 格式不合法' },
                { status: 400 }
              );
            if (!isValidApiTextParam(query, 200))
              return NextResponse.json(
                { error: 'query 格式不合法' },
                { status: 400 }
              );
            const entry = adminConfig.CustomCategories.find(
              (c) => c.query === query && c.type === type
            );
            if (!entry)
              return NextResponse.json(
                { error: '分類不存在' },
                { status: 404 }
              );
            entry.disabled = false;
            break;
          }
          case 'delete': {
            const { query, type } = body as {
              query?: string;
              type?: 'movie' | 'tv';
            };
            if (!query || !type)
              return NextResponse.json(
                { error: '缺少 query 或 type 參數' },
                { status: 400 }
              );
            if (!isCategoryType(type))
              return NextResponse.json(
                { error: 'type 格式不合法' },
                { status: 400 }
              );
            if (!isValidApiTextParam(query, 200))
              return NextResponse.json(
                { error: 'query 格式不合法' },
                { status: 400 }
              );
            const idx = adminConfig.CustomCategories.findIndex(
              (c) => c.query === query && c.type === type
            );
            if (idx === -1)
              return NextResponse.json(
                { error: '分類不存在' },
                { status: 404 }
              );
            const entry = adminConfig.CustomCategories[idx];
            if (entry.from === 'config') {
              return NextResponse.json(
                { error: '該分類不可刪除' },
                { status: 400 }
              );
            }
            adminConfig.CustomCategories.splice(idx, 1);
            break;
          }
          case 'sort': {
            const { order } = body as { order?: string[] };
            if (!Array.isArray(order)) {
              return NextResponse.json(
                { error: '排序列表格式錯誤' },
                { status: 400 }
              );
            }
            const map = new Map(
              adminConfig.CustomCategories.map((c) => [
                `${c.query}:${c.type}`,
                c,
              ])
            );
            const newList: typeof adminConfig.CustomCategories = [];
            order.forEach((key) => {
              const item = map.get(key);
              if (item) {
                newList.push(item);
                map.delete(key);
              }
            });
            // 未在 order 中的保持原順序
            adminConfig.CustomCategories.forEach((item) => {
              if (map.has(`${item.query}:${item.type}`)) newList.push(item);
            });
            adminConfig.CustomCategories = newList;
            break;
          }
          default:
            return NextResponse.json({ error: '未知操作' }, { status: 400 });
        }

        // 持久化到存储
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
    console.error('分類管理操作失敗:', error);
    return NextResponse.json(
      {
        error: '分類管理操作失敗',
        details: (error as Error).message,
      },
      { status: 500 }
    );
  }
}
