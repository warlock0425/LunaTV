import { lookup } from 'node:dns/promises';
import { ReadableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'node:util';

import {
  fetchSafeRemoteUrl,
  parseSafeRemoteUrl,
  readResponseBytesWithLimit,
  readResponseTextWithLimit,
} from './url-safety';

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

const mockAgentOptions: Array<{
  connect: {
    lookup: (
      hostname: string,
      options: { all?: boolean },
      callback: (
        err: Error | null,
        result: Array<{ address: string; family: number }>
      ) => void
    ) => void;
  };
}> = [];

jest.mock('undici', () => ({
  Agent: class {
    constructor(opts: (typeof mockAgentOptions)[number]) {
      mockAgentOptions.push(opts);
    }
    close() {
      return Promise.resolve();
    }
  },
}));

const mockedLookup = lookup as jest.MockedFunction<typeof lookup>;

Object.defineProperty(globalThis, 'TextDecoder', {
  configurable: true,
  value: TextDecoder,
});

function createTextResponse(text: string): Response {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return {
    body,
    headers: { get: () => null },
  } as unknown as Response;
}

describe('url safety helpers', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      body: null,
      headers: { get: jest.fn() },
      ok: true,
      status: 200,
    } as unknown as Response);
  });

  it('rejects obvious local and private URLs before fetching', async () => {
    expect(parseSafeRemoteUrl('http://127.0.0.1:3000/a.m3u8')).toBeNull();
    expect(parseSafeRemoteUrl('file:///etc/passwd')).toBeNull();

    await expect(fetchSafeRemoteUrl('http://localhost/a.m3u8')).rejects.toThrow(
      'Unsafe remote URL'
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects hostnames that resolve to private addresses', async () => {
    mockedLookup.mockResolvedValue([
      { address: '10.0.0.5', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    await expect(
      fetchSafeRemoteUrl('https://private.example.com/live.m3u8')
    ).rejects.toThrow('Unsafe resolved remote address');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects hexadecimal IPv4-mapped loopback addresses', async () => {
    await expect(
      fetchSafeRemoteUrl('http://[::ffff:7f00:1]/private')
    ).rejects.toThrow('Unsafe remote address');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('allows hostnames that resolve to public addresses', async () => {
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    const response = await fetchSafeRemoteUrl('https://example.com/live.m3u8');

    expect(response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.com/live.m3u8',
      expect.objectContaining({
        redirect: 'manual',
        dispatcher: expect.anything(),
      })
    );
  });

  it('pins the validated DNS result into the outbound dispatcher', async () => {
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    await fetchSafeRemoteUrl('https://pinned.example.com/video');

    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://pinned.example.com/video',
      expect.objectContaining({ dispatcher: expect.anything() })
    );
  });

  it('orders vetted addresses IPv4-first so hosts without IPv6 egress can connect', async () => {
    mockedLookup.mockResolvedValue([
      { address: '2606:4700:3034::ac43:a42f', family: 6 },
      { address: '104.21.41.102', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    await fetchSafeRemoteUrl('https://dual-stack.example.com/api');

    const opts = mockAgentOptions[mockAgentOptions.length - 1];
    const addresses = await new Promise<
      Array<{ address: string; family: number }>
    >((resolve, reject) => {
      opts.connect.lookup(
        'dual-stack.example.com',
        { all: true },
        (err, result) => (err ? reject(err) : resolve(result))
      );
    });

    expect(addresses.map((a) => a.family)).toEqual([4, 6]);
    expect(addresses[0].address).toBe('104.21.41.102');
  });

  it('caches safe DNS results to avoid repeated lookups for media segments', async () => {
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    await fetchSafeRemoteUrl('https://cdn.example.com/segment-1.ts');
    await fetchSafeRemoteUrl('https://cdn.example.com/segment-2.ts');

    expect(mockedLookup).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('reads bounded response text and rejects oversized bodies', async () => {
    await expect(
      readResponseTextWithLimit(createTextResponse('small'), 10)
    ).resolves.toBe('small');
    await expect(
      readResponseTextWithLimit(createTextResponse('too large'), 4)
    ).rejects.toThrow('exceeds 4 bytes');
  });

  it('reads bounded binary responses and rejects oversized bodies', async () => {
    await expect(
      readResponseBytesWithLimit(createTextResponse('small'), 10).then(
        Array.from
      )
    ).resolves.toEqual(Array.from(new TextEncoder().encode('small')));
    await expect(
      readResponseBytesWithLimit(createTextResponse('too large'), 4)
    ).rejects.toThrow('exceeds 4 bytes');
  });
});
