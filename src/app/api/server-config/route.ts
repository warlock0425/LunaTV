import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getStorageRuntimeStatus } from '@/lib/db';
import { logger } from '@/lib/logger';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  logger.debug('server-config called:', request.url);

  const config = await getConfig();
  const storageStatus = getStorageRuntimeStatus();
  const result = {
    SiteName: config.SiteConfig.SiteName,
    StorageType: storageStatus.type,
    StorageConfigured: storageStatus.configured,
    StorageMessage: storageStatus.message,
    Version: CURRENT_VERSION,
    ClientCompat: {
      selene: true,
      seleneTv: true,
    },
  };
  return NextResponse.json(result, {
    status: storageStatus.configured ? 200 : 503,
  });
}
