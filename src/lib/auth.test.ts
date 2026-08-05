import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';

import {
  __resetSessionSecretWarningForTests,
  AUTH_SESSION_MAX_AGE_MS,
  getAuthInfoFromCookie,
  getAuthSessionSecret,
  getAuthSignaturePayload,
  verifyAuthSession,
  verifySignature,
} from './auth';

Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  value: webcrypto,
});
Object.defineProperty(globalThis, 'TextEncoder', {
  configurable: true,
  value: TextEncoder,
});

// Polyfill Request for jsdom environment
if (typeof globalThis.Request === 'undefined') {
  class MockRequest {
    url: string;
    headers: { get: (name: string) => string | null };
    constructor(url: string, init?: { headers?: Record<string, string> }) {
      this.url = url;
      const hdrs = init?.headers || {};
      this.headers = {
        get: (name: string) => hdrs[name.toLowerCase()] || null,
      };
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Request = MockRequest;
}

async function sign(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  // node:util 的 TextEncoder 型別回傳 Uint8Array<ArrayBufferLike>，
  // Web Crypto 要求 BufferSource（ArrayBuffer 底層），需明確標註
  const encode = (text: string) =>
    encoder.encode(text) as Uint8Array<ArrayBuffer>;
  const key = await crypto.subtle.importKey(
    'raw',
    encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

describe('getAuthSignaturePayload', () => {
  it('returns subject:timestamp format', () => {
    expect(getAuthSignaturePayload('alice', 12345)).toBe('alice:12345:1');
  });

  it('handles empty subject', () => {
    expect(getAuthSignaturePayload('', 0)).toBe(':0:1');
  });
});

describe('getAuthSessionSecret', () => {
  const originalSession = process.env.SESSION_SECRET;
  const originalPassword = process.env.PASSWORD;

  beforeEach(() => {
    __resetSessionSecretWarningForTests();
    delete process.env.SESSION_SECRET;
    process.env.PASSWORD = 'fallback-password';
  });

  afterAll(() => {
    if (originalSession === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = originalSession;
    if (originalPassword === undefined) delete process.env.PASSWORD;
    else process.env.PASSWORD = originalPassword;
  });

  it('warns only once when falling back to PASSWORD', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getAuthSessionSecret()).toBe('fallback-password');
    expect(getAuthSessionSecret()).toBe('fallback-password');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('SESSION_SECRET');
    warn.mockRestore();
  });

  it('does not warn when SESSION_SECRET is set', () => {
    process.env.SESSION_SECRET = 'dedicated-secret';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getAuthSessionSecret()).toBe('dedicated-secret');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('verifySignature', () => {
  const secret = 'test-secret';

  it('accepts a valid HMAC-SHA-256 signature', async () => {
    const data = 'hello:123';
    const sig = await sign(data, secret);
    await expect(verifySignature(data, sig, secret)).resolves.toBe(true);
  });

  it('rejects an invalid signature', async () => {
    await expect(
      verifySignature('hello:123', 'deadbeef', secret)
    ).resolves.toBe(false);
  });

  it('rejects when data is tampered', async () => {
    const sig = await sign('hello:123', secret);
    await expect(verifySignature('hello:999', sig, secret)).resolves.toBe(
      false
    );
  });

  it('rejects when secret is wrong', async () => {
    const sig = await sign('hello:123', secret);
    await expect(
      verifySignature('hello:123', sig, 'wrong-secret')
    ).resolves.toBe(false);
  });

  it('rejects empty signature gracefully', async () => {
    await expect(verifySignature('hello:123', '', secret)).resolves.toBe(false);
  });
});

describe('verifyAuthSession', () => {
  const secret = 'test-secret';
  const subject = 'alice';
  const now = 1_800_000_000_000;

  it('accepts a valid unexpired signed session', async () => {
    const timestamp = now - 1000;
    const signature = await sign(
      getAuthSignaturePayload(subject, timestamp),
      secret
    );

    await expect(
      verifyAuthSession({ timestamp, signature }, subject, secret, now)
    ).resolves.toBe(true);
  });

  it('rejects expired sessions', async () => {
    const timestamp = now - AUTH_SESSION_MAX_AGE_MS - 1;
    const signature = await sign(
      getAuthSignaturePayload(subject, timestamp),
      secret
    );
    await expect(
      verifyAuthSession({ timestamp, signature }, subject, secret, now)
    ).resolves.toBe(false);
  });

  it('rejects timestamp tampering', async () => {
    const timestamp = now - 1000;
    const signature = await sign(
      getAuthSignaturePayload(subject, timestamp),
      secret
    );
    await expect(
      verifyAuthSession({ timestamp: now, signature }, subject, secret, now)
    ).resolves.toBe(false);
  });

  it('rejects missing signature', async () => {
    await expect(
      verifyAuthSession({ timestamp: now }, subject, secret, now)
    ).resolves.toBe(false);
  });

  it('rejects missing timestamp', async () => {
    await expect(
      verifyAuthSession({ signature: 'abc' }, subject, secret, now)
    ).resolves.toBe(false);
  });

  it('rejects non-integer timestamp', async () => {
    await expect(
      verifyAuthSession(
        { timestamp: 123.45, signature: 'abc' },
        subject,
        secret,
        now
      )
    ).resolves.toBe(false);
  });

  it('rejects future timestamp beyond clock skew', async () => {
    const futureTimestamp = now + 6 * 60 * 1000; // 6 minutes in the future
    const signature = await sign(
      getAuthSignaturePayload(subject, futureTimestamp),
      secret
    );
    await expect(
      verifyAuthSession(
        { timestamp: futureTimestamp, signature },
        subject,
        secret,
        now
      )
    ).resolves.toBe(false);
  });

  it('accepts timestamp within clock skew', async () => {
    const nearFutureTimestamp = now + 4 * 60 * 1000; // 4 minutes in the future
    const signature = await sign(
      getAuthSignaturePayload(subject, nearFutureTimestamp),
      secret
    );
    await expect(
      verifyAuthSession(
        { timestamp: nearFutureTimestamp, signature },
        subject,
        secret,
        now
      )
    ).resolves.toBe(true);
  });
});

describe('getAuthInfoFromCookie', () => {
  it('returns null when no auth cookie is present', () => {
    const request = new Request('http://localhost', {
      headers: { cookie: 'other=value' },
    });
    expect(getAuthInfoFromCookie(request)).toBeNull();
  });

  it('parses auth cookie from standard Request', () => {
    const authData = { username: 'alice', signature: 'abc', timestamp: 123 };
    const encoded = encodeURIComponent(JSON.stringify(authData));
    const request = new Request('http://localhost', {
      headers: { cookie: `auth=${encoded}` },
    });
    expect(getAuthInfoFromCookie(request)).toEqual(authData);
  });

  it('parses auth cookie among multiple cookies', () => {
    const authData = { username: 'bob' };
    const encoded = encodeURIComponent(JSON.stringify(authData));
    const request = new Request('http://localhost', {
      headers: { cookie: `session=xyz; auth=${encoded}; theme=dark` },
    });
    expect(getAuthInfoFromCookie(request)).toEqual(authData);
  });

  it('returns null for malformed cookie value', () => {
    const request = new Request('http://localhost', {
      headers: { cookie: 'auth=not-valid-json%ZZ' },
    });
    expect(getAuthInfoFromCookie(request)).toBeNull();
  });

  it('returns null when cookie header is empty', () => {
    const request = new Request('http://localhost', {
      headers: { cookie: '' },
    });
    expect(getAuthInfoFromCookie(request)).toBeNull();
  });
});
