/** @jest-environment node */

import { NextRequest } from 'next/server';

import { requireOwner } from '@/lib/api-auth';
import { resetConfig } from '@/lib/config';

import { GET, POST } from './route';

jest.mock('@/lib/api-auth', () => ({
  requireOwner: jest.fn(),
}));
jest.mock('@/lib/config', () => ({
  resetConfig: jest.fn(),
}));
jest.mock('@/lib/storage-runtime', () => ({
  getServerStorageType: jest.fn(() => 'redis'),
}));

const mockedAuth = jest.mocked(requireOwner);
const mockedResetConfig = jest.mocked(resetConfig);

function postRequest(
  origin: string | null,
  opts?: {
    url?: string;
    host?: string;
    forwardedHost?: string;
  }
) {
  const headers = new Headers();
  if (origin !== null) {
    headers.set('origin', origin);
  }
  if (opts?.host) {
    headers.set('host', opts.host);
  }
  if (opts?.forwardedHost) {
    headers.set('x-forwarded-host', opts.forwardedHost);
  }
  return new NextRequest(opts?.url ?? 'http://localhost/api/admin/reset', {
    method: 'POST',
    headers,
  });
}

describe('/api/admin/reset', () => {
  const originalTrustProxy = process.env.TRUST_PROXY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.USERNAME = 'owner';
    mockedAuth.mockResolvedValue({
      username: 'owner',
      auth: { username: 'owner', signature: 'signed', timestamp: Date.now() },
    } as never);
    mockedResetConfig.mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
  });

  it('GET 必須回 405（不得再以頂層導覽 CSRF 重置）', async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(mockedResetConfig).not.toHaveBeenCalled();
  });

  it('POST + 合法 Origin → 重置', async () => {
    const response = await POST(
      postRequest('http://localhost', { host: 'localhost' })
    );
    expect(response.status).toBe(200);
    expect(mockedResetConfig).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('POST + https Origin 與內部 http Host 同 host → 放行（TLS 邊緣終止）', async () => {
    // 正式站：瀏覽器 Origin 是 https，容器收到的是 http://內部位址
    // 必須比 host、不可比 scheme／nextUrl.origin
    const response = await POST(
      postRequest('https://example.com', {
        url: 'http://127.0.0.1:3000/api/admin/reset',
        host: 'example.com',
      })
    );
    expect(response.status).toBe(200);
    expect(mockedResetConfig).toHaveBeenCalledTimes(1);
  });

  it('POST + https Origin 與 x-forwarded-host 一致 → 放行', async () => {
    process.env.TRUST_PROXY = 'true';
    const response = await POST(
      postRequest('https://tv.example.com', {
        url: 'http://10.0.0.2:3000/api/admin/reset',
        host: '10.0.0.2:3000',
        forwardedHost: 'tv.example.com',
      })
    );
    expect(response.status).toBe(200);
    expect(mockedResetConfig).toHaveBeenCalledTimes(1);
    delete process.env.TRUST_PROXY;
  });

  it('未設 TRUST_PROXY 時不採信偽造的 X-Forwarded-Host', async () => {
    delete process.env.TRUST_PROXY;
    const response = await POST(
      postRequest('https://evil.example', {
        url: 'http://localhost/api/admin/reset',
        host: 'localhost',
        forwardedHost: 'evil.example',
      })
    );
    expect(response.status).toBe(403);
    expect(mockedResetConfig).not.toHaveBeenCalled();
  });

  it('POST + 跨站 Origin → 403', async () => {
    const response = await POST(
      postRequest('https://evil.example', { host: 'localhost' })
    );
    expect(response.status).toBe(403);
    expect(mockedResetConfig).not.toHaveBeenCalled();
  });

  it('POST 缺少 Origin → 403', async () => {
    const response = await POST(postRequest(null, { host: 'localhost' }));
    expect(response.status).toBe(403);
    expect(mockedResetConfig).not.toHaveBeenCalled();
  });

  it('POST 非站長 → 401', async () => {
    mockedAuth.mockResolvedValue(null);
    const response = await POST(
      postRequest('http://localhost', { host: 'localhost' })
    );
    expect(response.status).toBe(401);
    expect(mockedResetConfig).not.toHaveBeenCalled();
  });
});
