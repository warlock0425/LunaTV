const WEAK_SITE_PASSWORDS = new Set([
  'admin',
  'admin123',
  'password',
  'password123',
  '123456',
  '12345678',
  '123456789',
  '111111',
  '000000',
  'qwerty',
  'letmein',
  'lunatv',
  'moontv',
  'selene',
]);

/** 站台 PASSWORD 是否屬於常見弱口令（未設定由呼叫端另處理）。 */
export function isWeakSitePassword(
  password: string | undefined | null
): boolean {
  if (!password) return false;
  return WEAK_SITE_PASSWORDS.has(password.trim().toLowerCase());
}
