/** @jest-environment node */

import { getConfig } from '@/lib/config';
import { getStorageRuntimeStatus } from '@/lib/db';

import { GET } from './route';

jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/db', () => ({ getStorageRuntimeStatus: jest.fn() }));
jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn() },
}));
jest.mock('@/lib/version', () => ({ CURRENT_VERSION: 'test-version' }));
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status || 200,
      json: async () => body,
    }),
  },
}));

const mockedGetConfig = jest.mocked(getConfig);
const mockedGetStorageRuntimeStatus = jest.mocked(getStorageRuntimeStatus);

describe('/api/server-config storage health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetConfig.mockResolvedValue({
      SiteConfig: { SiteName: 'Test Site' },
    } as Awaited<ReturnType<typeof getConfig>>);
  });

  it('returns 503 with diagnostics when remote storage is not configured', async () => {
    mockedGetStorageRuntimeStatus.mockReturnValue({
      type: 'redis',
      configured: false,
      message: 'Missing required env: REDIS_URL',
      missing: ['REDIS_URL'],
    });

    const response = await GET({
      url: 'http://localhost/api/server-config',
    } as never);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        StorageType: 'redis',
        StorageConfigured: false,
        StorageMessage: 'Missing required env: REDIS_URL',
      })
    );
  });

  it('keeps localstorage mode healthy', async () => {
    mockedGetStorageRuntimeStatus.mockReturnValue({
      type: 'localstorage',
      configured: true,
      message: 'localStorage mode',
      missing: [],
    });

    const response = await GET({
      url: 'http://localhost/api/server-config',
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ StorageConfigured: true })
    );
  });
});
