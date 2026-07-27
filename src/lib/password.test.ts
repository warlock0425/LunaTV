import { hashPassword, isHashed, verifyPassword } from './password';

/**
 * 密碼雜湊是登入的最後一道關卡，但先前完全沒有測試（函式覆蓋率 0%）。
 *
 * 這裡除了基本行為外，特別鎖住兩個容易在重構中被弄壞、且壞掉不會有任何
 * 報錯的地方：
 *   1. 每次雜湊都必須用新的隨機 salt（否則相同密碼會產生相同雜湊，
 *      一次外洩就能比對出所有共用密碼的帳號）。
 *   2. 明文相容路徑只在「舊格式」時走，不能讓雜湊格式意外掉進去比對明文。
 */
describe('password', () => {
  describe('hashPassword', () => {
    it('產生 salt:hash 格式', () => {
      const stored = hashPassword('my-secret');
      const parts = stored.split(':');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toMatch(/^[0-9a-f]{32}$/); // 16 bytes salt
      expect(parts[1]).toMatch(/^[0-9a-f]{128}$/); // 64 bytes key
    });

    it('相同密碼每次都產生不同結果（salt 必須隨機）', () => {
      const a = hashPassword('same-password');
      const b = hashPassword('same-password');
      expect(a).not.toBe(b);
      expect(a.split(':')[0]).not.toBe(b.split(':')[0]);
      // 但兩者都必須能驗證通過
      expect(verifyPassword('same-password', a)).toBe(true);
      expect(verifyPassword('same-password', b)).toBe(true);
    });

    it('不把明文留在輸出裡', () => {
      expect(hashPassword('plaintext-leak-check')).not.toContain(
        'plaintext-leak-check'
      );
    });
  });

  describe('verifyPassword（雜湊格式）', () => {
    it('正確密碼通過', () => {
      expect(verifyPassword('correct', hashPassword('correct'))).toBe(true);
    });

    it('錯誤密碼不通過', () => {
      const stored = hashPassword('correct');
      expect(verifyPassword('wrong', stored)).toBe(false);
      expect(verifyPassword('Correct', stored)).toBe(false); // 大小寫敏感
      expect(verifyPassword('correct ', stored)).toBe(false); // 不自動 trim
      expect(verifyPassword('', stored)).toBe(false);
    });

    it('支援 unicode 與長密碼', () => {
      const pw = '密碼🔐-with-ünicode-' + 'x'.repeat(200);
      expect(verifyPassword(pw, hashPassword(pw))).toBe(true);
      expect(verifyPassword(pw + '!', hashPassword(pw))).toBe(false);
    });

    it('雜湊段長度對但含非 hex 字元時回傳 false 而非拋錯', () => {
      // Buffer.from(..., 'hex') 遇到非 hex 字元會在該處截斷，產生短 buffer；
      // 直接餵給 timingSafeEqual 會拋 RangeError，讓登入回 500 而不是「密碼錯誤」。
      const corrupted = '0'.repeat(32) + ':' + 'z'.repeat(128);
      expect(() => verifyPassword('anything', corrupted)).not.toThrow();
      expect(verifyPassword('anything', corrupted)).toBe(false);

      const partiallyCorrupted =
        '0'.repeat(32) + ':' + 'ab'.repeat(60) + 'zzzzzzzz';
      expect(() =>
        verifyPassword('anything', partiallyCorrupted)
      ).not.toThrow();
      expect(verifyPassword('anything', partiallyCorrupted)).toBe(false);
    });
  });

  describe('verifyPassword（舊的明文相容路徑）', () => {
    it('明文相符時通過（未遷移的舊資料仍可登入）', () => {
      expect(verifyPassword('legacy-pw', 'legacy-pw')).toBe(true);
    });

    it('明文不符時不通過', () => {
      expect(verifyPassword('legacy-pw', 'other-pw')).toBe(false);
    });

    it('長度不同時不通過且不拋錯（避免長度造成的時序差異）', () => {
      expect(() =>
        verifyPassword('short', 'a-much-longer-value')
      ).not.toThrow();
      expect(verifyPassword('short', 'a-much-longer-value')).toBe(false);
    });

    it('看起來像雜湊但長度不對的值，走明文比對而非誤判為雜湊', () => {
      const notAHash = 'abc:def';
      expect(verifyPassword('abc:def', notAHash)).toBe(true);
      expect(verifyPassword('abc', notAHash)).toBe(false);
    });
  });

  describe('isHashed', () => {
    it('辨識雜湊格式', () => {
      expect(isHashed(hashPassword('x'))).toBe(true);
    });

    it('辨識非雜湊格式', () => {
      expect(isHashed('plain-password')).toBe(false);
      expect(isHashed('abc:def')).toBe(false);
      expect(isHashed('')).toBe(false);
      expect(isHashed(':')).toBe(false);
      // salt 長度對但 hash 長度不對
      expect(isHashed('0'.repeat(32) + ':' + '0'.repeat(64))).toBe(false);
    });
  });
});
