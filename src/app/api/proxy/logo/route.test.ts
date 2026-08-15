/** @jest-environment node */

import { getVerifiedAuthInfo } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import {
  fetchSafeRemoteUrl,
  readResponseBytesWithLimit,
  RemoteResponseTooLargeError,
} from '@/lib/url-safety';

import { GET } from './route';

jest.mock('@/lib/api-auth', () => ({ getVerifiedAuthInfo: jest.fn() }));
jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/url-safety', () => {
  const actual = jest.requireActual('@/lib/url-safety');
  return {
    ...actual,
    fetchSafeRemoteUrl: jest.fn(),
    readResponseBytesWithLimit: jest.fn(),
  };
});

const mockedGetVerifiedAuth = jest.mocked(getVerifiedAuthInfo);
const mockedConfig = jest.mocked(getConfig);
const mockedFetch = jest.mocked(fetchSafeRemoteUrl);
const mockedReadBytes = jest.mocked(readResponseBytesWithLimit);

describe('live logo proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetVerifiedAuth.mockResolvedValue({
      username: 'localstorage',
      signature: 'signed',
      timestamp: Date.now(),
    });
    mockedConfig.mockResolvedValue({
      LiveConfig: [
        {
          key: 'live',
          url: 'https://example.com/list.m3u',
          name: 'live',
          from: 'custom',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
    mockedFetch.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'Content-Type': 'image/png' },
      })
    );
  });

  it('未登入時回 401，且不會對外發出請求', async () => {
    mockedGetVerifiedAuth.mockResolvedValue(null);

    const response = await GET(
      new Request(
        'http://localhost/api/proxy/logo?url=https%3A%2F%2Fimg.example%2Fa.png'
      )
    );

    expect(response.status).toBe(401);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('returns 413 for a chunked image that exceeds the byte limit', async () => {
    mockedReadBytes.mockRejectedValue(
      new RemoteResponseTooLargeError(10 * 1024 * 1024)
    );

    const response = await GET(
      new Request(
        'http://localhost/api/proxy/logo?url=https%3A%2F%2Fexample.com%2Flogo.png&moontv-source=live'
      )
    );

    expect(response.status).toBe(413);
  });

  it('rejects a host that does not belong to the live source', async () => {
    const response = await GET(
      new Request(
        'http://localhost/api/proxy/logo?url=https%3A%2F%2Fevil.example%2Flogo.png&moontv-source=live'
      )
    );

    expect(response.status).toBe(403);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('returns 504 when the upstream body times out', async () => {
    mockedReadBytes.mockRejectedValue(
      new DOMException('Aborted', 'AbortError')
    );

    const response = await GET(
      new Request(
        'http://localhost/api/proxy/logo?url=https%3A%2F%2Fexample.com%2Flogo.png&moontv-source=live'
      )
    );

    expect(response.status).toBe(504);
  });
});
