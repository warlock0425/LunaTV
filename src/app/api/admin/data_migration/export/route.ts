/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gzip } from 'zlib';

import { requireOwner } from '@/lib/api-auth';
import { readJsonObject } from '@/lib/api-input-validation';
import { enforceRateLimit } from '@/lib/api-rate-limit';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { rejectCrossSiteRequest } from '@/lib/same-site';
import { getServerStorageType } from '@/lib/storage-runtime';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

const gzipAsync = promisify(gzip);

async function getUserPassword(username: string): Promise<string | null> {
  try {
    const client = (db as any).storage?.client;
    if (client && typeof client.get === 'function') {
      return (await client.get(`u:${username}:pwd`)) || null;
    }
  } catch {
    // Password export is best-effort; user data can still be exported.
  }
  return null;
}

function formatTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
}

export async function POST(req: NextRequest) {
  const crossSite = rejectCrossSiteRequest(req);
  if (crossSite) return crossSite;

  try {
    if (getServerStorageType() === 'localstorage') {
      return NextResponse.json(
        { error: 'localStorage 模式不支援伺服器資料匯出' },
        { status: 400 }
      );
    }

    const owner = await requireOwner(req);
    if (!owner) {
      return NextResponse.json(
        { error: '只有站長可以匯出資料' },
        { status: 403 }
      );
    }

    const limited = await enforceRateLimit(req, {
      namespace: 'admin-migration',
      limit: 5,
      windowSeconds: 60,
    });
    if (limited) return limited;

    const body = await readJsonObject(req);
    if (!body) {
      return NextResponse.json(
        { error: '請提供有效的 JSON 物件' },
        { status: 400 }
      );
    }
    if (typeof body.password !== 'string' || !body.password.trim()) {
      return NextResponse.json({ error: '請輸入備份密碼' }, { status: 400 });
    }

    const adminConfig = await db.getAdminConfig();
    if (!adminConfig) {
      return NextResponse.json({ error: '無法讀取管理設定' }, { status: 500 });
    }

    const users = await db.getAllUsers();
    const configuredUsers = adminConfig.UserConfig.Users.map(
      (user) => user.username
    );
    const uniqueUsers = Array.from(
      new Set(
        [...users, ...configuredUsers, process.env.USERNAME].filter(Boolean)
      )
    ) as string[];
    const userData: Record<string, any> = {};

    for (const username of uniqueUsers) {
      userData[username] = {
        playRecords: await db.getAllPlayRecords(username),
        favorites: await db.getAllFavorites(username),
        searchHistory: await db.getSearchHistory(username),
        skipConfigs: await db.getAllSkipConfigs(username),
        password:
          username === process.env.USERNAME
            ? null
            : await getUserPassword(username),
      };
    }

    const now = new Date();
    const compressed = await gzipAsync(
      JSON.stringify({
        timestamp: now.toISOString(),
        serverVersion: CURRENT_VERSION,
        data: { adminConfig, userData },
      })
    );
    const encrypted = SimpleCrypto.encrypt(
      compressed.toString('base64'),
      body.password
    );
    const filename = `moontv-backup-${formatTimestamp(now)}.dat`;

    return new NextResponse(encrypted, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': Buffer.byteLength(encrypted).toString(),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('資料匯出失敗:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '資料匯出失敗' },
      { status: 500 }
    );
  }
}
