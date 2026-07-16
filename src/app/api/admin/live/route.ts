/* eslint-disable no-console,no-case-declarations */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig, setCachedConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { deleteCachedLiveChannels, refreshLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    // 權限檢查
    const authInfo = getAuthInfoFromCookie(request);
    const username = authInfo?.username;
    const config = await getConfig();
    if (username !== process.env.USERNAME) {
      // 管理員
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '權限不足' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { action, key, name, url, ua, epg } = body;

    if (!config) {
      return NextResponse.json({ error: '配置不存在' }, { status: 404 });
    }

    // 確保 LiveConfig 存在
    if (!config.LiveConfig) {
      config.LiveConfig = [];
    }

    switch (action) {
      case 'add':
        // 檢查是否已存在相同的 key
        if (config.LiveConfig.some((l) => l.key === key)) {
          return NextResponse.json(
            { error: '直播源 key 已存在' },
            { status: 400 }
          );
        }

        const liveInfo = {
          key: key as string,
          name: name as string,
          url: url as string,
          ua: ua || '',
          epg: epg || '',
          from: 'custom' as 'custom' | 'config',
          channelNumber: 0,
          disabled: false,
        };

        try {
          const nums = await refreshLiveChannels(liveInfo);
          liveInfo.channelNumber = nums;
        } catch (error) {
          console.error('重新整理直播源失敗:', error);
          liveInfo.channelNumber = 0;
        }

        // 新增新的直播源
        config.LiveConfig.push(liveInfo);
        break;

      case 'delete':
        // 刪除直播源
        const deleteIndex = config.LiveConfig.findIndex((l) => l.key === key);
        if (deleteIndex === -1) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }

        const liveSource = config.LiveConfig[deleteIndex];
        if (liveSource.from === 'config') {
          return NextResponse.json(
            { error: '不能刪除配置文件中的直播源' },
            { status: 400 }
          );
        }

        deleteCachedLiveChannels(key);

        config.LiveConfig.splice(deleteIndex, 1);
        break;

      case 'enable':
        // 啟用直播源
        const enableSource = config.LiveConfig.find((l) => l.key === key);
        if (!enableSource) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }
        enableSource.disabled = false;
        break;

      case 'disable':
        // 禁用直播源
        const disableSource = config.LiveConfig.find((l) => l.key === key);
        if (!disableSource) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }
        disableSource.disabled = true;
        break;

      case 'edit':
        // 編輯直播源
        const editSource = config.LiveConfig.find((l) => l.key === key);
        if (!editSource) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }

        // 配置文件中的直播源不允許編輯
        if (editSource.from === 'config') {
          return NextResponse.json(
            { error: '不能編輯配置文件中的直播源' },
            { status: 400 }
          );
        }

        // 更新字段（除了 key 和 from）
        editSource.name = name as string;
        editSource.url = url as string;
        editSource.ua = ua || '';
        editSource.epg = epg || '';

        // 重新整理頻道數
        try {
          const nums = await refreshLiveChannels(editSource);
          editSource.channelNumber = nums;
        } catch (error) {
          console.error('重新整理直播源失敗:', error);
          editSource.channelNumber = 0;
        }
        break;

      case 'sort':
        // 排序直播源
        const { order } = body;
        if (!Array.isArray(order)) {
          return NextResponse.json(
            { error: '排序資料格式錯誤' },
            { status: 400 }
          );
        }

        // 創建新的排序後的數組
        const sortedLiveConfig: typeof config.LiveConfig = [];
        order.forEach((key) => {
          const source = config.LiveConfig?.find((l) => l.key === key);
          if (source) {
            sortedLiveConfig.push(source);
          }
        });

        // 新增未在排序列表中的直播源（保持原有順序）
        config.LiveConfig.forEach((source) => {
          if (!order.includes(source.key)) {
            sortedLiveConfig.push(source);
          }
        });

        config.LiveConfig = sortedLiveConfig;
        break;

      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    // 儲存配置
    await db.saveAdminConfig(config);
    setCachedConfig(config);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失敗' },
      { status: 500 }
    );
  }
}
