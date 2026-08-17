/** @jest-environment node */

import { isSameSiteHost, rejectCrossSiteRequest } from './same-site';

function requestWith(headers: Record<string, string>, url?: string) {
  return new Request(url || 'http://localhost/api/admin/reset', { headers });
}

describe('isSameSiteHost', () => {
  const originalTrustProxy = process.env.TRUST_PROXY;

  afterEach(() => {
    if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = originalTrustProxy;
  });

  it('rejects missing Origin', () => {
    expect(isSameSiteHost(requestWith({ host: 'localhost' }))).toBe(false);
  });

  it('allows Origin host to match Host regardless of scheme', () => {
    expect(
      isSameSiteHost(
        requestWith(
          { origin: 'https://example.com', host: 'example.com' },
          'http://127.0.0.1:3000/api/admin/reset'
        )
      )
    ).toBe(true);
  });

  it('rejects a cross-site Origin', () => {
    expect(
      isSameSiteHost(
        requestWith({ origin: 'https://evil.example', host: 'localhost' })
      )
    ).toBe(false);
  });

  it('ignores spoofed X-Forwarded-Host unless TRUST_PROXY is set', () => {
    delete process.env.TRUST_PROXY;
    expect(
      isSameSiteHost(
        requestWith({
          origin: 'https://evil.example',
          host: 'localhost',
          'x-forwarded-host': 'evil.example',
        })
      )
    ).toBe(false);
  });

  it('uses X-Forwarded-Host when TRUST_PROXY is set', () => {
    process.env.TRUST_PROXY = 'true';
    expect(
      isSameSiteHost(
        requestWith({
          origin: 'https://tv.example.com',
          host: '10.0.0.2:3000',
          'x-forwarded-host': 'tv.example.com',
        })
      )
    ).toBe(true);
  });
});

describe('rejectCrossSiteRequest', () => {
  it('returns 403 for cross-site requests and null for same-site', () => {
    expect(
      rejectCrossSiteRequest(
        requestWith({ origin: 'https://evil.example', host: 'localhost' })
      )?.status
    ).toBe(403);
    expect(
      rejectCrossSiteRequest(
        requestWith({ origin: 'http://localhost', host: 'localhost' })
      )
    ).toBeNull();
  });
});
