import CryptoJS from 'crypto-js';

import { SimpleCrypto } from './crypto';

const PAYLOAD = JSON.stringify({
  users: [{ username: 'alice', password: 'salt:hash' }],
  note: '中文與 emoji 🎬 都要能還原',
});

describe('SimpleCrypto', () => {
  it('加密後可用相同密碼還原', () => {
    const encrypted = SimpleCrypto.encrypt(PAYLOAD, 'correct-horse');
    expect(SimpleCrypto.decrypt(encrypted, 'correct-horse')).toBe(PAYLOAD);
  });

  it('輸出 v2 格式且不洩漏明文', () => {
    const encrypted = SimpleCrypto.encrypt(PAYLOAD, 'pw');
    expect(encrypted.startsWith('LUNATV-BK-v2:')).toBe(true);
    expect(encrypted).not.toContain('alice');
  });

  it('每次加密都使用不同的 salt 與 iv', () => {
    const a = SimpleCrypto.encrypt(PAYLOAD, 'pw');
    const b = SimpleCrypto.encrypt(PAYLOAD, 'pw');
    expect(a).not.toBe(b);
  });

  it('密碼錯誤時拋出', () => {
    const encrypted = SimpleCrypto.encrypt(PAYLOAD, 'pw');
    expect(() => SimpleCrypto.decrypt(encrypted, 'wrong')).toThrow(
      '解密失敗，請檢查密碼是否正確'
    );
    expect(SimpleCrypto.canDecrypt(encrypted, 'wrong')).toBe(false);
    expect(SimpleCrypto.canDecrypt(encrypted, 'pw')).toBe(true);
  });

  it('密文遭竄改時拋出（GCM 完整性驗證）', () => {
    const encrypted = SimpleCrypto.encrypt(PAYLOAD, 'pw');
    const raw = Buffer.from(encrypted.slice('LUNATV-BK-v2:'.length), 'base64');
    raw[raw.length - 1] ^= 0xff;
    const tampered = 'LUNATV-BK-v2:' + raw.toString('base64');

    expect(() => SimpleCrypto.decrypt(tampered, 'pw')).toThrow(
      '解密失敗，請檢查密碼是否正確'
    );
  });

  it('內容過短的 v2 備份視為解密失敗', () => {
    const truncated = 'LUNATV-BK-v2:' + Buffer.alloc(8).toString('base64');
    expect(() => SimpleCrypto.decrypt(truncated, 'pw')).toThrow(
      '解密失敗，請檢查密碼是否正確'
    );
  });

  describe('舊格式（v1）相容', () => {
    it('仍可還原 CryptoJS 產生的既有備份', () => {
      const legacy = CryptoJS.AES.encrypt(PAYLOAD, 'legacy-pw').toString();
      expect(SimpleCrypto.decrypt(legacy, 'legacy-pw')).toBe(PAYLOAD);
    });

    it('舊格式密碼錯誤時拋出', () => {
      const legacy = CryptoJS.AES.encrypt(PAYLOAD, 'legacy-pw').toString();
      expect(() => SimpleCrypto.decrypt(legacy, 'nope')).toThrow(
        '解密失敗，請檢查密碼是否正確'
      );
    });
  });
});
