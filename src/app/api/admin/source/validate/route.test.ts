/** @jest-environment node */

import { NextRequest } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getAdminUser, getConfig } from '@/lib/config';
import { fetchSafeRemoteUrl } from '@/lib/url-safety';

import { GET } from './route';

jest.mock('@/lib/auth', () => ({ getAuthInfoFromCookie: jest.fn() }));
jest.mock('@/lib/config', () => ({
  API_CONFIG: { search: { headers: {} } },
  getAdminUser: jest.fn(),
  getConfig: jest.fn(),
}));
jest.mock('@/lib/url-safety', () => ({ fetchSafeRemoteUrl: jest.fn() }));

const mockedGetAuth = jest.mocked(getAuthInfoFromCookie);
const mockedGetAdminUser = jest.mocked(getAdminUser);
const mockedGetConfig = jest.mocked(getConfig);
const mockedFetch = jest.mocked(fetchSafeRemoteUrl);

function createRequest() {
  return new NextRequest(
    'http://localhost/api/admin/source/validate?q=example'
  );
}

function createSites(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    key: `source-${index}`,
    name: `Source ${index}`,
    api: `https://source-${index}.example/api.php/provide/vod`,
  }));
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Condition was not met');
}

describe('/api/admin/source/validate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAuth.mockReturnValue({
      username: 'owner',
      signature: 'signed',
      timestamp: Date.now(),
    });
    mockedGetAdminUser.mockResolvedValue({
      username: 'owner',
    } as Awaited<ReturnType<typeof getAdminUser>>);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('limits concurrent source validations', async () => {
    mockedGetConfig.mockResolvedValue({
      SourceConfig: createSites(14),
    } as Awaited<ReturnType<typeof getConfig>>);

    let activeRequests = 0;
    let maxActiveRequests = 0;
    let releaseRequests!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });

    mockedFetch.mockImplementation(async () => {
      activeRequests++;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await gate;
      activeRequests--;
      return new Response(JSON.stringify({ list: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const response = await GET(createRequest());
    await waitFor(() => mockedFetch.mock.calls.length === 6);

    expect(maxActiveRequests).toBe(6);
    expect(mockedFetch).toHaveBeenCalledTimes(6);

    releaseRequests();
    const body = await response.text();

    expect(mockedFetch).toHaveBeenCalledTimes(14);
    expect(maxActiveRequests).toBe(6);
    expect(body).toContain('"type":"complete"');
    expect(body).toContain('"completedSources":14');
  });

  it('aborts active requests and does not start queued requests after cancellation', async () => {
    mockedGetConfig.mockResolvedValue({
      SourceConfig: createSites(14),
    } as Awaited<ReturnType<typeof getConfig>>);

    const signals: AbortSignal[] = [];
    mockedFetch.mockImplementation((_url, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      return new Promise<Response>((_resolve, reject) => {
        const rejectWithAbort = () =>
          reject(new DOMException('Aborted', 'AbortError'));
        if (signal.aborted) {
          rejectWithAbort();
        } else {
          signal.addEventListener('abort', rejectWithAbort, { once: true });
        }
      });
    });

    const response = await GET(createRequest());
    await waitFor(() => signals.length === 6);

    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await waitFor(() => signals.every((signal) => signal.aborted));

    expect(mockedFetch).toHaveBeenCalledTimes(6);
    expect(signals).toHaveLength(6);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('keeps the timeout active while parsing the response body', async () => {
    jest.useFakeTimers();
    mockedGetConfig.mockResolvedValue({
      SourceConfig: createSites(1),
    } as Awaited<ReturnType<typeof getConfig>>);

    let requestSignal: AbortSignal | undefined;
    mockedFetch.mockImplementation(async (_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            const rejectWithAbort = () =>
              reject(new DOMException('Aborted', 'AbortError'));
            if (requestSignal!.aborted) {
              rejectWithAbort();
            } else {
              requestSignal!.addEventListener('abort', rejectWithAbort, {
                once: true,
              });
            }
          }),
      } as Response;
    });

    const response = await GET(createRequest());
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(10_000);
    const body = await response.text();

    expect(requestSignal?.aborted).toBe(true);
    expect(body).toContain('"type":"source_error"');
    expect(body).toContain('"type":"complete"');
  });

  it('completes immediately when no sources are configured', async () => {
    mockedGetConfig.mockResolvedValue({
      SourceConfig: [],
    } as unknown as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET(createRequest());
    const body = await response.text();

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(body).toContain('"type":"start"');
    expect(body).toContain('"type":"complete"');
    expect(body).toContain('"completedSources":0');
  });
});
