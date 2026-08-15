import { lookup } from 'node:dns/promises';
import { ReadableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'node:util';

import {
  fetchSafeRemoteUrl,
  getSafeImageContentType,
  parseSafeRemoteUrl,
  readResponseBytesWithLimit,
  readResponseJsonWithLimit,
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

  it.each(['fe80::1', 'fe90::1', 'fea0::1', 'febf::1'])(
    'rejects IPv6 link-local literal %s',
    (address) => {
      expect(parseSafeRemoteUrl(`http://[${address}]/private`)).toBeNull();
    }
  );

  it('rejects hostnames that resolve anywhere inside fe80::/10', async () => {
    mockedLookup.mockResolvedValue([
      { address: 'fe9f::1234', family: 6 },
    ] as unknown as Awaited<ReturnType<typeof lookup>>);

    await expect(
      fetchSafeRemoteUrl('https://ipv6-link-local.example.com/private')
    ).rejects.toThrow('Unsafe resolved remote address');
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

  it('parses bounded JSON and rejects oversized JSON bodies', async () => {
    await expect(
      readResponseJsonWithLimit<{ ok: boolean }>(
        createTextResponse('{"ok":true}'),
        20
      )
    ).resolves.toEqual({ ok: true });
    await expect(
      readResponseJsonWithLimit(createTextResponse('{"ok":true}'), 4)
    ).rejects.toThrow('exceeds 4 bytes');
  });

  /**
   * dns.lookup 走 libuv 執行緒池（預設 4 條）且不吃 AbortSignal，呼叫端的
   * AbortController 完全管不到它。慢速或無回應的解析器會佔滿執行緒池，
   * 連帶拖垮同行程的檔案 I/O、gzip 與 scrypt。以下三條把防護釘死。
   */
  describe('DNS 解析的執行緒池防護', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('同一主機名的並發查詢只實際解析一次', async () => {
      mockedLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
      ] as unknown as Awaited<ReturnType<typeof lookup>>);

      await Promise.all([
        fetchSafeRemoteUrl('https://dedupe-probe.example.com/1.m3u8'),
        fetchSafeRemoteUrl('https://dedupe-probe.example.com/2.m3u8'),
        fetchSafeRemoteUrl('https://dedupe-probe.example.com/3.m3u8'),
      ]);

      expect(mockedLookup).toHaveBeenCalledTimes(1);
    });

    it('解析卡住時會逾時，不會無限期等待', async () => {
      jest.useFakeTimers();
      mockedLookup.mockReturnValue(
        new Promise(() => undefined) as ReturnType<typeof lookup>
      );

      const pending = fetchSafeRemoteUrl('https://hung-dns.example.com/1.m3u8');
      const assertion = expect(pending).rejects.toThrow(
        'Unable to resolve remote host'
      );
      await jest.advanceTimersByTimeAsync(5000);
      await assertion;

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('解析失敗會進負面快取，死掉的主機不會每次都再賠一次逾時', async () => {
      mockedLookup.mockRejectedValue(new Error('ENOTFOUND'));

      await expect(
        fetchSafeRemoteUrl('https://dead-host-probe.example.com/1.m3u8')
      ).rejects.toThrow('Unable to resolve remote host');
      await expect(
        fetchSafeRemoteUrl('https://dead-host-probe.example.com/2.m3u8')
      ).rejects.toThrow('Unable to resolve remote host');

      expect(mockedLookup).toHaveBeenCalledTimes(1);
    });
  });
});

describe('getSafeImageContentType', () => {
  it('allows real image types and rejects generic binaries', () => {
    expect(getSafeImageContentType('image/png')).toBe('image/png');
    expect(getSafeImageContentType('image/jpeg; charset=binary')).toBe(
      'image/jpeg'
    );
    expect(getSafeImageContentType('application/octet-stream')).toBeNull();
    expect(getSafeImageContentType('text/html')).toBeNull();
  });
});
