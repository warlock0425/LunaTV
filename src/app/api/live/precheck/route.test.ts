/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getConfig } from '@/lib/config';
import {
  fetchSafeRemoteUrl,
  readResponseTextWithLimit,
} from '@/lib/url-safety';

import { GET } from './route';

jest.mock('@/lib/config', () => ({ getConfig: jest.fn() }));
jest.mock('@/lib/url-safety', () => ({
  fetchSafeRemoteUrl: jest.fn(),
  readResponseTextWithLimit: jest.fn(),
  UnsafeRemoteUrlError: class extends Error {},
}));

const mockedGetConfig = jest.mocked(getConfig);
const mockedFetch = jest.mocked(fetchSafeRemoteUrl);
const mockedReadText = jest.mocked(readResponseTextWithLimit);

function request() {
  return new NextRequest(
    'http://localhost/api/live/precheck?url=https%3A%2F%2Fcdn.example%2Flive&moontv-source=live'
  );
}

describe('/api/live/precheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetConfig.mockResolvedValue({
      LiveConfig: [{ key: 'live', ua: 'Test UA' }],
    } as Awaited<ReturnType<typeof getConfig>>);
  });

  it('rejects HTML instead of labelling it as m3u8', async () => {
    mockedFetch.mockResolvedValue(
      new Response('<html>login</html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    );

    const response = await GET(request());

    expect(response.status).toBe(415);
    expect(mockedReadText).not.toHaveBeenCalled();
  });

  it('accepts a manifest only after checking its EXTM3U signature', async () => {
    const upstream = new Response('#EXTM3U');
    mockedFetch.mockResolvedValue(upstream);
    mockedReadText.mockResolvedValue('#EXTM3U\n#EXTINF:1,One');

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      type: 'm3u8',
    });
    expect(mockedReadText).toHaveBeenCalledWith(upstream, 512 * 1024);
  });

  it('rejects a disabled source before fetching upstream', async () => {
    mockedGetConfig.mockResolvedValue({
      LiveConfig: [{ key: 'live', disabled: true }],
    } as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
