import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';

import {
  getVerifiedAuthInfo,
  requireActiveUser,
  requireAdmin,
  requireOwner,
} from './api-auth';
import { getAuthSignaturePayload } from './auth';
import { getConfig } from './config';

jest.mock('./config', () => ({
  getConfig: jest.fn(),
}));

const mockedGetConfig = jest.mocked(getConfig);

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

const SECRET = 'server-secret';

async function sign(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
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

function requestWithAuth(authData: unknown): Request {
  const cookie = `auth=${encodeURIComponent(JSON.stringify(authData))}`;
  return new Request('https://example.com/api/admin/reset', {
    headers: { cookie },
  });
}

/** 產生一份對 `subject` 而言簽章正確的 cookie 內容 */
async function signedAuth(
  subject: string,
  overrides: Record<string, unknown> = {},
  timestamp = Date.now()
) {
  return {
    username: subject,
    timestamp,
    sessionVersion: 1,
    signature: await sign(
      getAuthSignaturePayload(subject, timestamp, 1),
      SECRET
    ),
    ...overrides,
  };
}

describe('getVerifiedAuthInfo', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, PASSWORD: SECRET, STORAGE_TYPE: 'redis' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('沒有 cookie 時回傳 null', async () => {
    const request = new Request('https://example.com/api/admin/reset');
    await expect(getVerifiedAuthInfo(request)).resolves.toBeNull();
  });

  it('接受簽章正確的 session', async () => {
    const request = requestWithAuth(await signedAuth('alice'));
    const result = await getVerifiedAuthInfo(request);
    expect(result?.username).toBe('alice');
  });

  it('沒有 signature 欄位時回傳 null', async () => {
    const request = requestWithAuth({ username: 'alice', timestamp: 1 });
    await expect(getVerifiedAuthInfo(request)).resolves.toBeNull();
  });

  // 這是本 helper 存在的理由：cookie 內容完全由客戶端控制，
  // 只解析不驗簽的話，冒用他人身分等於零成本。
  it('拒絕冒用他人使用者名稱的偽造 cookie', async () => {
    const alice = await signedAuth('alice');
    const forged = { ...alice, username: 'owner' };
    await expect(
      getVerifiedAuthInfo(requestWithAuth(forged))
    ).resolves.toBeNull();
  });

  it('拒絕憑空捏造的 cookie', async () => {
    const request = requestWithAuth({
      username: 'owner',
      timestamp: Date.now(),
      sessionVersion: 1,
      signature: 'de'.repeat(32),
    });
    await expect(getVerifiedAuthInfo(request)).resolves.toBeNull();
  });

  it('拒絕以別的密鑰簽出來的 session', async () => {
    const timestamp = Date.now();
    const request = requestWithAuth({
      username: 'alice',
      timestamp,
      sessionVersion: 1,
      signature: await sign(
        getAuthSignaturePayload('alice', timestamp, 1),
        'other-secret'
      ),
    });
    await expect(getVerifiedAuthInfo(request)).resolves.toBeNull();
  });

  it('拒絕過期的 session', async () => {
    const expired = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const request = requestWithAuth(await signedAuth('alice', {}, expired));
    await expect(getVerifiedAuthInfo(request)).resolves.toBeNull();
  });

  it('未設定 PASSWORD 時回傳 null', async () => {
    const request = requestWithAuth(await signedAuth('alice'));
    delete process.env.PASSWORD;
    await expect(getVerifiedAuthInfo(request)).resolves.toBeNull();
  });

  describe('localstorage 模式', () => {
    beforeEach(() => {
      process.env.STORAGE_TYPE = 'localstorage';
    });

    it('以固定主體 localstorage 驗簽', async () => {
      // 登入時簽的是 'localstorage'，cookie 內的 username 也是它
      const request = requestWithAuth(await signedAuth('localstorage'));
      const result = await getVerifiedAuthInfo(request);
      expect(result?.username).toBe('localstorage');
    });

    it('拒絕對其他主體簽名的 session', async () => {
      const request = requestWithAuth(await signedAuth('alice'));
      await expect(getVerifiedAuthInfo(request)).resolves.toBeNull();
    });
  });
});

describe('requireActiveUser', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, PASSWORD: SECRET, USERNAME: 'owner' };
    delete process.env.NEXT_PUBLIC_STORAGE_TYPE;
    mockedGetConfig.mockResolvedValue({
      UserConfig: { Users: [] },
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('rejects unsigned cookies', async () => {
    const req = requestWithAuth({ username: 'owner', timestamp: Date.now() });
    await expect(requireActiveUser(req)).resolves.toBeNull();
  });

  it('accepts a valid owner session without loading user DB', async () => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'redis';
    const req = requestWithAuth(await signedAuth('owner'));
    const active = await requireActiveUser(req);
    expect(active?.username).toBe('owner');
  });

  it('maps localstorage sessions to the localstorage username', async () => {
    process.env.NEXT_PUBLIC_STORAGE_TYPE = 'localstorage';
    const payload = {
      ...(await signedAuth('localstorage')),
    };
    delete (payload as { username?: string }).username;
    const req = requestWithAuth(payload);
    const active = await requireActiveUser(req);
    expect(active?.username).toBe('localstorage');
  });
});

describe('requireAdmin / requireOwner', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      PASSWORD: SECRET,
      USERNAME: 'owner',
      STORAGE_TYPE: 'redis',
    };
    mockedGetConfig.mockResolvedValue({
      UserConfig: {
        Users: [
          { username: 'bob', role: 'admin', banned: false },
          { username: 'alice', role: 'user', banned: false },
        ],
      },
    } as unknown as Awaited<ReturnType<typeof getConfig>>);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('requireOwner 只接受環境變數 USERNAME', async () => {
    await expect(
      requireOwner(requestWithAuth(await signedAuth('owner')))
    ).resolves.toEqual(expect.objectContaining({ username: 'owner' }));
    await expect(
      requireOwner(requestWithAuth(await signedAuth('bob')))
    ).resolves.toBeNull();
  });

  it('requireAdmin 接受站長與管理員，拒絕一般使用者', async () => {
    await expect(
      requireAdmin(requestWithAuth(await signedAuth('owner')))
    ).resolves.toEqual(expect.objectContaining({ role: 'owner' }));
    await expect(
      requireAdmin(requestWithAuth(await signedAuth('bob')))
    ).resolves.toEqual(expect.objectContaining({ role: 'admin' }));
    await expect(
      requireAdmin(requestWithAuth(await signedAuth('alice')))
    ).resolves.toBeNull();
  });
});
