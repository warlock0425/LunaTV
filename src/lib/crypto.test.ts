import CryptoJS from 'crypto-js';

import { SimpleCrypto } from './crypto';

const PAYLOAD = JSON.stringify({
  users: [{ username: 'alice', password: 'salt:hash' }],
  note: '中文與 emoji 🎬 都要能還原',
});

/**
 * 與 production export 相同：加密的是 base64(gzip(JSON))，不是裸 JSON。
 * 明文與密文皆為固定常數，避免：
 * 1) gzip 跨環境不確定性
 * 2) AES.encrypt 隨機 salt 讓「錯密碼」測試偶發拿到合法 Utf8 亂碼
 */
const LEGACY_PLAINTEXT =
  'H4sIAAAAAAAACqtWKi1OLSpWsoquBrPyEnNTlayUEnMyk1OVdJQKEouLy/OLUpSslIoTc0qsMhKLM5RqY3WU8vJLQOqe7Fj7bFr7i452hdTc/KxMhQ/z+9YovGze+2JZ44vmvS+bWp72zVeqBQAW0/OKZQAAAA==';
// CryptoJS.AES.encrypt(LEGACY_PLAINTEXT, 'legacy-pw') 一次產物
const FIXED_LEGACY_CIPHERTEXT =
  'U2FsdGVkX1+Wr42AN23P646m8zENoc1VKXDsDQXr7zYjHHzrCWwCPSqIOA/6p+YVknmNDE/BQtAuHH7HXwmJqH21/AdOkiDdqzkU9aIKHCMM39j667k+Nnpupn1nJWaIwFXJwT1EFRNVG6gFqoCklIbKncESY8iBMslI9RjgMFBFCOOt+g9xlUijH2Mj/163elzArqYi91zhJyCKBGVkLbbjNESbIWSbRRRdmm63chjkTSB9Iypl65PNrdiCvvMQ';

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
    it('fixture 明文是 base64(gzip)（與 export 契約一致）', () => {
      const raw = Buffer.from(LEGACY_PLAINTEXT, 'base64');
      expect(raw[0]).toBe(0x1f);
      expect(raw[1]).toBe(0x8b);
    });

    it('仍可還原固定的 CryptoJS 既有備份', () => {
      expect(SimpleCrypto.decrypt(FIXED_LEGACY_CIPHERTEXT, 'legacy-pw')).toBe(
        LEGACY_PLAINTEXT
      );
    });

    it('現場產生的舊格式密文也能還原', () => {
      const legacy = CryptoJS.AES.encrypt(
        LEGACY_PLAINTEXT,
        'legacy-pw'
      ).toString();
      expect(SimpleCrypto.decrypt(legacy, 'legacy-pw')).toBe(LEGACY_PLAINTEXT);
    });

    it('舊格式密碼錯誤時必定拋出（固定密文，不碰運氣）', () => {
      expect(() =>
        SimpleCrypto.decrypt(FIXED_LEGACY_CIPHERTEXT, 'nope')
      ).toThrow(/解密失敗/);
      expect(SimpleCrypto.canDecrypt(FIXED_LEGACY_CIPHERTEXT, 'nope')).toBe(
        false
      );
    });

    it('解密出非 gzip、非 JSON 的內容會被擋（模擬 Utf8 碰巧非空）', () => {
      // 合法 base64 字元但不是 gzip、也不是 JSON → 不得當成成功
      const junk = CryptoJS.AES.encrypt(
        'not-a-gzip-payload!!!!!!!!',
        'x'
      ).toString();
      expect(() => SimpleCrypto.decrypt(junk, 'x')).toThrow(/解密失敗/);
    });

    it('仍接受假想中的裸 JSON 舊格式明文', () => {
      const bareJson = JSON.stringify({ adminConfig: {}, userData: {} });
      const legacy = CryptoJS.AES.encrypt(bareJson, 'legacy-pw').toString();
      expect(SimpleCrypto.decrypt(legacy, 'legacy-pw')).toBe(bareJson);
    });
  });
});
