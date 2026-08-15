import {
  DEFAULT_SITE_NAME,
  isLegacyDefaultSiteName,
  resolveSiteName,
} from './site-defaults';

describe('site-defaults', () => {
  it('recognizes old fork default names', () => {
    expect(isLegacyDefaultSiteName('MoonTV')).toBe(true);
    expect(isLegacyDefaultSiteName('BerserkerTV')).toBe(true);
    expect(isLegacyDefaultSiteName('我家的站')).toBe(false);
  });

  it('prefers NEXT_PUBLIC_SITE_NAME, then keeps a custom name', () => {
    expect(resolveSiteName('MoonTV', '  自訂站  ')).toBe('自訂站');
    expect(resolveSiteName('我家的站', undefined)).toBe('我家的站');
    expect(resolveSiteName('BerserkerTV', undefined)).toBe(DEFAULT_SITE_NAME);
    expect(resolveSiteName('', undefined)).toBe(DEFAULT_SITE_NAME);
  });
});
