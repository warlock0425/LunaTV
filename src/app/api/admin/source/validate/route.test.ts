/** @jest-environment node */

import { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/api-auth';
import { getConfig } from '@/lib/config';
import { validateSourceSite } from '@/lib/source-validation';

import { GET } from './route';

jest.mock('@/lib/api-auth', () => ({ requireAdmin: jest.fn() }));
jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));
jest.mock('@/lib/source-validation', () => ({
  validateSourceSite: jest.fn(),
}));

const mockedGetAuth = jest.mocked(requireAdmin);
const mockedGetConfig = jest.mocked(getConfig);
const mockedValidate = jest.mocked(validateSourceSite);

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
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('Condition was not met');
}

describe('/api/admin/source/validate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAuth.mockResolvedValue({
      username: 'owner',
      role: 'owner',
      auth: { username: 'owner', signature: 'signed', timestamp: Date.now() },
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
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

    mockedValidate.mockImplementation(async (site) => {
      activeRequests++;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await gate;
      activeRequests--;
      return {
        source: site.key,
        status: 'no_results',
        levels: { search: 'pass', detail: 'skip', playable: 'skip' },
        message: 'API 可達，但無搜尋結果',
        resultCount: 0,
        episodeCount: 0,
        latencyMs: 1,
        checkedAt: Date.now(),
      };
    });

    const response = await GET(createRequest());
    // 目前 concurrency = 4
    await waitFor(() => mockedValidate.mock.calls.length === 4);

    expect(maxActiveRequests).toBe(4);
    expect(mockedValidate).toHaveBeenCalledTimes(4);

    releaseRequests();
    const body = await response.text();

    expect(mockedValidate).toHaveBeenCalledTimes(14);
    expect(maxActiveRequests).toBe(4);
    expect(body).toContain('"type":"complete"');
    expect(body).toContain('"completedSources":14');
    expect(body).toContain('"type":"source_result"');
  });

  it('aborts active requests and does not start queued requests after cancellation', async () => {
    mockedGetConfig.mockResolvedValue({
      SourceConfig: createSites(14),
    } as Awaited<ReturnType<typeof getConfig>>);

    const signals: AbortSignal[] = [];
    mockedValidate.mockImplementation((_site, options) => {
      const signal = options?.signal as AbortSignal;
      signals.push(signal);
      return new Promise((_resolve, reject) => {
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
    await waitFor(() => signals.length === 4);

    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await waitFor(() => signals.every((signal) => signal.aborted));

    expect(mockedValidate).toHaveBeenCalledTimes(4);
    expect(signals).toHaveLength(4);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('returns invalid when validation throws', async () => {
    mockedGetConfig.mockResolvedValue({
      SourceConfig: createSites(1),
    } as Awaited<ReturnType<typeof getConfig>>);
    mockedValidate.mockRejectedValue(new Error('boom'));

    const response = await GET(createRequest());
    const body = await response.text();

    expect(body).toContain('"type":"source_error"');
    expect(body).toContain('"status":"invalid"');
    expect(body).toContain('"type":"complete"');
  });

  it('completes immediately when no sources are configured', async () => {
    mockedGetConfig.mockResolvedValue({
      SourceConfig: [],
    } as unknown as Awaited<ReturnType<typeof getConfig>>);

    const response = await GET(createRequest());
    const body = await response.text();

    expect(mockedValidate).not.toHaveBeenCalled();
    expect(body).toContain('"type":"start"');
    expect(body).toContain('"type":"complete"');
    expect(body).toContain('"completedSources":0');
  });

  it('rejects unauthorized callers', async () => {
    mockedGetAuth.mockResolvedValue(null);
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });
});
