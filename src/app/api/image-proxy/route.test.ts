/** @jest-environment node */

import { NextResponse } from 'next/server';

import { enforceRateLimit } from '@/lib/api-rate-limit';
import {
  fetchSafeRemoteUrl,
  isSafeRemoteUrl,
  readResponseBytesWithLimit,
  RemoteResponseTooLargeError,
} from '@/lib/url-safety';

import { GET } from './route';

jest.mock('@/lib/api-rate-limit', () => ({
  enforceRateLimit: jest.fn(),
}));

jest.mock('@/lib/url-safety', () => {
  const actual = jest.requireActual('@/lib/url-safety');
  return {
    ...actual,
    fetchSafeRemoteUrl: jest.fn(),
    isSafeRemoteUrl: jest.fn(),
    readResponseBytesWithLimit: jest.fn(),
  };
});

const mockedFetch = jest.mocked(fetchSafeRemoteUrl);
const mockedIsSafe = jest.mocked(isSafeRemoteUrl);
const mockedReadBytes = jest.mocked(readResponseBytesWithLimit);
const mockedRateLimit = jest.mocked(enforceRateLimit);

describe('image proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedRateLimit.mockResolvedValue(null);
    mockedIsSafe.mockReturnValue(true);
    mockedFetch.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'Content-Type': 'image/png' },
      })
    );
  });

  it('超過限流時回 429，且不對外發出任何請求', async () => {
    mockedRateLimit.mockResolvedValue(
      NextResponse.json({ error: 'too many' }, { status: 429 })
    );

    const response = await GET(
      new Request(
        'http://localhost/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fimage.png'
      )
    );

    expect(response.status).toBe(429);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('returns 413 before responding when a chunked image exceeds the limit', async () => {
    mockedReadBytes.mockRejectedValue(
      new RemoteResponseTooLargeError(20 * 1024 * 1024)
    );

    const response = await GET(
      new Request(
        'http://localhost/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fimage.png'
      )
    );

    expect(response.status).toBe(413);
  });

  it('keeps the timeout signal active while the response body is read', async () => {
    mockedReadBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const response = await GET(
      new Request(
        'http://localhost/api/image-proxy?url=https%3A%2F%2Fexample.com%2Fimage.png'
      )
    );

    expect(response.status).toBe(200);
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://example.com/image.png',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });
});
