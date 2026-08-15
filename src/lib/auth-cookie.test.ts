import {
  getAuthCookieOptions,
  getUserInfoCookieOptions,
  shouldUseSecureCookies,
} from './auth-cookie';

function request(url: string, headers: Record<string, string> = {}) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    url,
    headers: {
      get: (name: string) => lower[name.toLowerCase()] ?? null,
    },
  };
}

describe('shouldUseSecureCookies', () => {
  it('COOKIE_SECURE 明確覆蓋其他來源', () => {
    expect(
      shouldUseSecureCookies(request('http://192.168.1.8:3000'), {
        COOKIE_SECURE: 'true',
        SITE_BASE: 'http://example.com',
      })
    ).toBe(true);
    expect(
      shouldUseSecureCookies(request('https://tv.example.com'), {
        COOKIE_SECURE: 'false',
      })
    ).toBe(false);
  });

  it('直連 HTTP 不設 Secure，避免 LAN / NAS 登入 cookie 被丟棄', () => {
    expect(shouldUseSecureCookies(request('http://192.168.1.8:3000'), {})).toBe(
      false
    );
  });

  it('信任第一個 x-forwarded-proto', () => {
    expect(
      shouldUseSecureCookies(
        request('http://127.0.0.1:3000', {
          'x-forwarded-proto': 'https, http',
        }),
        {}
      )
    ).toBe(true);
    expect(
      shouldUseSecureCookies(
        request('https://internal', { 'x-forwarded-proto': 'http' }),
        { SITE_BASE: 'https://tv.example.com' }
      )
    ).toBe(false);
  });

  it('反代沒帶 proto 時，host 對得上 https SITE_BASE 才設 Secure', () => {
    expect(
      shouldUseSecureCookies(
        request('http://127.0.0.1:3000', { host: 'tv.example.com' }),
        { SITE_BASE: 'https://tv.example.com' }
      )
    ).toBe(true);
    expect(
      shouldUseSecureCookies(request('http://192.168.1.8:3000'), {
        SITE_BASE: 'https://tv.example.com',
      })
    ).toBe(false);
  });

  it('auth / user_info 的 Secure 一致，只有 httpOnly 不同', () => {
    const req = request('http://192.168.1.8:3000');
    const expires = new Date('2026-01-01T00:00:00.000Z');
    expect(getAuthCookieOptions(req, expires)).toEqual({
      path: '/',
      expires,
      sameSite: 'lax',
      httpOnly: true,
      secure: false,
    });
    expect(getUserInfoCookieOptions(req, expires)).toEqual({
      path: '/',
      expires,
      sameSite: 'lax',
      httpOnly: false,
      secure: false,
    });
  });
});
