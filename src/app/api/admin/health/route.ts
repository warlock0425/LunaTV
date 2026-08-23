import { NextRequest, NextResponse } from 'next/server';

import { requireOwner } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import { getCronHealthStatus } from '@/lib/cron-health';
import { db } from '@/lib/db';
import { getTrippedSources } from '@/lib/source-circuit-breaker';
import { getSourceHealthSnapshots } from '@/lib/source-health';
import { getLastValidationResults } from '@/lib/source-validation';
import { getStorageRuntimeStatus } from '@/lib/storage-runtime';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!(await requireOwner(request))) {
    return NextResponse.json({ error: '權限不足' }, { status: 401 });
  }

  const storage = getStorageRuntimeStatus();
  const startedAt = performance.now();
  let storageConnected = false;
  let storageError: string | null = null;
  let sourceCount = 0;
  let enabledSourceCount = 0;
  let liveSourceCount = 0;

  try {
    await db.getAdminConfig();
    storageConnected = true;
    const config = await getConfig();
    sourceCount = config.SourceConfig?.length || 0;
    enabledSourceCount =
      config.SourceConfig?.filter((source) => !source.disabled).length || 0;
    liveSourceCount =
      config.LiveConfig?.filter((source) => !source.disabled).length || 0;
  } catch (error) {
    storageError = error instanceof Error ? error.message : 'Unknown error';
  }

  const cron = getCronHealthStatus();
  const degraded = !storage.configured || !storageConnected;

  return NextResponse.json(
    {
      status: degraded ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      version: CURRENT_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      storage: {
        type: storage.type,
        configured: storage.configured,
        connected: storageConnected,
        latencyMs: Math.round(performance.now() - startedAt),
        message: storageError || storage.message,
        missing: storage.missing,
      },
      cron,
      sources: {
        total: sourceCount,
        enabled: enabledSourceCount,
        liveEnabled: liveSourceCount,
        health: getSourceHealthSnapshots().slice(0, 50),
        validations: getLastValidationResults().slice(0, 50),
        // 熔斷中的來源（連續逾時被暫時跳過）
        tripped: getTrippedSources().map((entry) => ({
          key: entry.sourceKey,
          untilISO: new Date(entry.openUntil).toISOString(),
          consecutiveFailures: entry.consecutiveFailures,
        })),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
