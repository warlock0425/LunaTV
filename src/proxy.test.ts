/** @jest-environment node */

import { shouldSkipAuth } from './proxy';

describe('proxy public PWA assets', () => {
  it.each([
    '/offline.html',
    '/splash/splash-750x1334.png',
    '/screenshot1.png',
    '/screenshot2.png',
    '/screenshot3.png',
  ])('allows %s without authentication', (pathname) => {
    expect(shouldSkipAuth(pathname)).toBe(true);
  });

  it('does not retain the obsolete screenshot path exception', () => {
    expect(shouldSkipAuth('/screenshot.png')).toBe(false);
  });
});
