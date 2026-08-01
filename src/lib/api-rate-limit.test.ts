/** @jest-environment node */

import {
  enforceRateLimit,
  getClientIp,
  getRateLimitIdentity,
} from './api-rate-limit';
import { consumeRateLimit } from './security-store';
import { getServerStorageType } from './storage-runtime';

jest.mock('./security-store', () => ({
  consumeRateLimit: jest.fn(),
}));

jest.mock('./storage-runtime', () => ({
  getServerStorageType: jest.fn(),
}));

const mockedConsume = jest.mocked(consumeRateLimit);
const mockedStorageType = jest.mocked(getServerStorageType);

const OPTIONS = { namespace: 'test-ns', limit: 10, windowSeconds: 60 };

function requestWith(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/whatever', { headers });
}

function authCookie(payload: Record<string, unknown>) {
  return `auth=${encodeURIComponent(JSON.stringify(payload))}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedConsume.mockResolvedValue({ blocked: false, retryAfter: 0 });
  // 預設用多使用者模式：該模式下 username 有簽章覆蓋，可以當身分
  mockedStorageType.mockReturnValue('redis');
});

describe('getClientIp', () => {
  it('取 x-forwarded-for 的第一段並去除空白', () => {
    expect(
      getClientIp(requestWith({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' }))
    ).toBe('1.2.3.4');
  });

  it('沒有 x-forwarded-for 時退回 x-real-ip', () => {
    expect(getClientIp(requestWith({ 'x-real-ip': '9.9.9.9' }))).toBe(
      '9.9.9.9'
    );
  });

  it('兩者皆無時回 unknown', () => {
    expect(getClientIp(requestWith())).toBe('unknown');
  });

  it('截斷過長的標頭，避免灌爆 key 空間', () => {
    const long = 'a'.repeat(500);
    expect(getClientIp(requestWith({ 'x-real-ip': long }))).toHaveLength(128);
  });
});

describe('enforceRateLimit', () => {
  it('未超限時回 null，讓 route 繼續執行', async () => {
    await expect(enforceRateLimit(requestWith(), OPTIONS)).resolves.toBeNull();
  });

  it('超限時回 429 並帶 Retry-After', async () => {
    mockedConsume.mockResolvedValue({ blocked: true, retryAfter: 42 });

    const response = await enforceRateLimit(requestWith(), OPTIONS);

    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('42');
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
  });

  it('已登入時以使用者名稱計數，同一 NAT 後的使用者不互相拖累', async () => {
    await enforceRateLimit(
      requestWith({ cookie: authCookie({ username: 'alice' }) }),
      OPTIONS
    );

    expect(mockedConsume).toHaveBeenCalledWith('test-ns', 'user:alice', 10, 60);
  });

  it('沒有 cookie 時退回 IP 計數', async () => {
    await enforceRateLimit(requestWith({ 'x-real-ip': '1.2.3.4' }), OPTIONS);

    expect(mockedConsume).toHaveBeenCalledWith('test-ns', 'ip:1.2.3.4', 10, 60);
  });

  it('cookie 中的 username 同樣會被截斷', async () => {
    await enforceRateLimit(
      requestWith({ cookie: authCookie({ username: 'u'.repeat(500) }) }),
      OPTIONS
    );

    const identity = mockedConsume.mock.calls[0][1];
    expect(identity).toBe(`user:${'u'.repeat(128)}`);
  });

  it('cookie 損毀時不拋錯，退回 IP 計數', async () => {
    await enforceRateLimit(
      requestWith({ cookie: 'auth=%7Bnot-json', 'x-real-ip': '1.2.3.4' }),
      OPTIONS
    );

    expect(mockedConsume).toHaveBeenCalledWith('test-ns', 'ip:1.2.3.4', 10, 60);
  });

  it('不同 namespace 使用各自的計數桶', async () => {
    await enforceRateLimit(requestWith(), { ...OPTIONS, namespace: 'a' });
    await enforceRateLimit(requestWith(), { ...OPTIONS, namespace: 'b' });

    expect(mockedConsume.mock.calls[0][0]).toBe('a');
    expect(mockedConsume.mock.calls[1][0]).toBe('b');
  });
});

/**
 * localstorage 模式的簽章 subject 是字面值 'localstorage'（proxy.ts、
 * api-auth.ts），cookie 的 username 欄位不在簽章範圍內，使用者可以任意改動
 * 而簽章照樣通過。若拿它當計數 key，輪換 username 就能無限重置額度。
 */
describe('getRateLimitIdentity：只有被簽章覆蓋的 username 才能當身分', () => {
  it('localstorage 模式下輪換 username，身分不變（額度無法重置）', () => {
    mockedStorageType.mockReturnValue('localstorage');

    const identities = [
      'localstorage',
      'attacker-bucket-1',
      'attacker-bucket-2',
      '',
    ].map((username) =>
      getRateLimitIdentity(
        requestWith({
          cookie: authCookie({ username }),
          'x-real-ip': '1.2.3.4',
        })
      )
    );

    expect(new Set(identities)).toEqual(new Set(['ip:1.2.3.4']));
  });

  it('localstorage 模式即使 cookie 完全沒有 username 也是同一個身分', () => {
    mockedStorageType.mockReturnValue('localstorage');

    expect(getRateLimitIdentity(requestWith({ 'x-real-ip': '1.2.3.4' }))).toBe(
      'ip:1.2.3.4'
    );
  });

  it.each(['redis', 'kvrocks', 'upstash'] as const)(
    '%s 模式下 username 有簽章覆蓋，仍以使用者計數',
    (storageType) => {
      mockedStorageType.mockReturnValue(storageType);

      expect(
        getRateLimitIdentity(
          requestWith({
            cookie: authCookie({ username: 'alice' }),
            'x-real-ip': '1.2.3.4',
          })
        )
      ).toBe('user:alice');
    }
  );

  it('多使用者模式下不同使用者仍分開計數，不會互相拖累', () => {
    mockedStorageType.mockReturnValue('redis');

    const alice = getRateLimitIdentity(
      requestWith({ cookie: authCookie({ username: 'alice' }) })
    );
    const bob = getRateLimitIdentity(
      requestWith({ cookie: authCookie({ username: 'bob' }) })
    );

    expect(alice).not.toBe(bob);
  });

  it('enforceRateLimit 走的是同一套身分判斷', async () => {
    mockedStorageType.mockReturnValue('localstorage');

    await enforceRateLimit(
      requestWith({
        cookie: authCookie({ username: 'attacker-bucket-1' }),
        'x-real-ip': '1.2.3.4',
      }),
      OPTIONS
    );

    expect(mockedConsume).toHaveBeenCalledWith('test-ns', 'ip:1.2.3.4', 10, 60);
  });
});
