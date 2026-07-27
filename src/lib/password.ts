import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SCRYPT_COST = 16384; // N
const BLOCK_SIZE = 8; // r
const PARALLELIZATION = 1; // p

/**
 * 對密碼進行加鹽雜湊，回傳格式: `salt:hash`
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  }).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * 驗證密碼是否匹配儲存的雜湊值
 * 支援兩種格式:
 * - 加鹽雜湊: `salt:hash` (新格式)
 * - 明文密碼: 不含 `:` 或長度不符合雜湊格式 (舊格式，兼容遷移期)
 */
export function verifyPassword(password: string, storedValue: string): boolean {
  // 判断是否为加盐哈希格式 (salt:hash, salt 32 hex chars, hash 128 hex chars)
  const parts = storedValue.split(':');
  if (
    parts.length === 2 &&
    parts[0].length === SALT_LENGTH * 2 &&
    parts[1].length === KEY_LENGTH * 2
  ) {
    const [salt, storedHash] = parts;
    const storedHashBuf = Buffer.from(storedHash, 'hex');
    // 長度對但含非 hex 字元時 Buffer.from 會在該字元處截斷，長度就會短於
    // KEY_LENGTH，直接丟給 timingSafeEqual 會拋 RangeError，讓登入變成 500
    // 而不是「密碼錯誤」。資料毀損時應該當作驗證失敗。
    if (storedHashBuf.length !== KEY_LENGTH) {
      return false;
    }
    const hash = scryptSync(password, salt, KEY_LENGTH, {
      N: SCRYPT_COST,
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
    });
    return timingSafeEqual(hash, storedHashBuf);
  }

  // 舊格式：明文密碼比對（防時序攻擊版，兼容未遷移的資料）
  const storedBuf = Buffer.from(storedValue, 'utf8');
  const inputBuf = Buffer.from(password, 'utf8');
  if (storedBuf.length !== inputBuf.length) {
    // 長度不同必然不匹配，但仍執行一次比對避免長度洩漏時序
    timingSafeEqual(storedBuf, storedBuf);
    return false;
  }
  return timingSafeEqual(storedBuf, inputBuf);
}

/**
 * 判斷儲存的密碼值是否已經是加鹽雜湊格式
 */
export function isHashed(storedValue: string): boolean {
  const parts = storedValue.split(':');
  return (
    parts.length === 2 &&
    parts[0].length === SALT_LENGTH * 2 &&
    parts[1].length === KEY_LENGTH * 2
  );
}
