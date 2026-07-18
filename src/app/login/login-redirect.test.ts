import { getSafeLoginRedirect } from './login-redirect';

describe('getSafeLoginRedirect', () => {
  it('保留站內單斜線路徑及查詢參數', () => {
    expect(getSafeLoginRedirect('/play?id=1#episode')).toBe(
      '/play?id=1#episode'
    );
  });

  it.each([
    null,
    '',
    'https://evil.example/path',
    '//evil.example/path',
    '/\\evil.example/path',
    '/%2e%2e//evil.example/path',
    'javascript:alert(1)',
  ])('拒絕非站內路徑 %p', (redirect) => {
    expect(getSafeLoginRedirect(redirect)).toBe('/');
  });
});
