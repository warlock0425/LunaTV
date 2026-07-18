/** @jest-environment node */

import { getConfig } from '@/lib/config';
import {
  fetchSafeRemoteUrl,
  readResponseBytesWithLimit,
  RemoteResponseTooLargeError,
} from '@/lib/url-safety';

import { GET } from './route';

jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/url-safety', () => {
  const actual = jest.requireActual('@/lib/url-safety');
  return {
    ...actual,
    fetchSafeRemoteUrl: jest.fn(),
    readResponseBytesWithLimit: jest.fn(),
  };
});

const mockedConfig = jest.mocked(getConfig);
const mockedFetch = jest.mocked(fetchSafeRemoteUrl);
const mockedReadBytes = jest.mocked(readResponseBytesWithLimit);

describe('live logo proxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedConfig.mockResolvedValue({
      LiveConfig: [],
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
    mockedFetch.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { 'Content-Type': 'image/png' },
      })
    );
  });

  it('returns 413 for a chunked image that exceeds the byte limit', async () => {
    mockedReadBytes.mockRejectedValue(
      new RemoteResponseTooLargeError(10 * 1024 * 1024)
    );

    const response = await GET(
      new Request(
        'http://localhost/api/proxy/logo?url=https%3A%2F%2Fexample.com%2Flogo.png'
      )
    );

    expect(response.status).toBe(413);
  });

  it('returns 504 when the upstream body times out', async () => {
    mockedReadBytes.mockRejectedValue(
      new DOMException('Aborted', 'AbortError')
    );

    const response = await GET(
      new Request(
        'http://localhost/api/proxy/logo?url=https%3A%2F%2Fexample.com%2Flogo.png'
      )
    );

    expect(response.status).toBe(504);
  });
});
