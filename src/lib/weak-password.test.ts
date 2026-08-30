import { isWeakSitePassword } from './weak-password';

describe('isWeakSitePassword', () => {
  it('rejects common default passwords regardless of case or padding', () => {
    expect(isWeakSitePassword('admin')).toBe(true);
    expect(isWeakSitePassword('Admin123')).toBe(true);
    expect(isWeakSitePassword('  password  ')).toBe(true);
    expect(isWeakSitePassword('123456')).toBe(true);
  });

  it('allows empty (handled as unset) and ordinary secrets', () => {
    expect(isWeakSitePassword('')).toBe(false);
    expect(isWeakSitePassword(undefined)).toBe(false);
    expect(isWeakSitePassword('e2e-test-password')).toBe(false);
  });
});
