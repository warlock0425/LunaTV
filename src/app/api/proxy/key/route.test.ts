/** @jest-environment node */

import { getAuthInfoFromCookie, verifyAuthSession } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  fetchSafeRemoteUrl,
  readResponseBytesWithLimit,
} from '@/lib/url-safety';

import { GET } from './route';

jest.mock('@/lib/auth', () => ({
  getAuthInfoFromCookie: jest.fn(),
  verifyAuthSession: jest.fn(),
}));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/url-safety', () => ({
  fetchSafeRemoteUrl: jest.fn(),
  isSafeRemoteUrl: jest.fn(() => true),
  readResponseBytesWithLimit: jest.fn(),
  UnsafeRemoteUrlError: class extends Error {},
}));

const mockedGetAuthInfo = jest.mocked(getAuthInfoFromCookie);
const mockedVerifyAuth = jest.mocked(verifyAuthSession);
const mockedGetConfig = jest.mocked(getConfig);
const mockedFetch = jest.mocked(fetchSafeRemoteUrl);
const mockedReadBytes = jest.mocked(readResponseBytesWithLimit);

describe('/api/proxy/key', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STORAGE_TYPE = 'localstorage';
    process.env.PASSWORD = 'secret';
    mockedGetAuthInfo.mockReturnValue({
      username: 'localstorage',
      signature: 'signed',
      timestamp: Date.now(),
    });
    mockedVerifyAuth.mockResolvedValue(true);
    mockedGetConfig.mockResolvedValue({
      LiveConfig: [{ key: 'live', ua: 'Custom UA' }],
    } as Awaited<ReturnType<typeof getConfig>>);
  });

  afterAll(() => {
    delete process.env.STORAGE_TYPE;
    delete process.env.PASSWORD;
  });

  it('applies a timeout signal and a bounded key response reader', async () => {
    const upstream = new Response(new Uint8Array([1, 2, 3]));
    mockedFetch.mockResolvedValue(upstream);
    mockedReadBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const response = await GET(
      new Request(
        'http://localhost/api/proxy/key?url=https%3A%2F%2Fcdn.example%2Fkey.bin&moontv-source=live'
      )
    );

    expect(mockedFetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(mockedReadBytes).toHaveBeenCalledWith(upstream, 1024 * 1024);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });

  it('rejects a disabled live source before fetching upstream', async () => {
    mockedGetConfig.mockResolvedValue({
      LiveConfig: [{ key: 'live', disabled: true }],
    } as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET(
      new Request(
        'http://localhost/api/proxy/key?url=https%3A%2F%2Fcdn.example%2Fkey.bin&moontv-source=live'
      )
    );

    expect(response.status).toBe(404);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
