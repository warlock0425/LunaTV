import CryptoJS from 'crypto-js';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

/**
 * 備份檔案的對稱加密工具（僅在伺服器端使用）
 *
 * v2 格式：scrypt 導出金鑰 + AES-256-GCM
 *   `LUNATV-BK-v2:` + base64(salt(16) ‖ iv(12) ‖ authTag(16) ‖ ciphertext)
 *
 * v1（舊格式）用的是 CryptoJS.AES.encrypt(data, passphrase)，其金鑰由
 * OpenSSL 的 EVP_BytesToKey 導出——MD5、只迭代一次。備份檔內含全站使用者
 * 資料與密碼雜湊，用那種強度保護等同離線可爆破，因此改用 scrypt。
 * 解密仍保留 v1 路徑，讓既有的備份檔還原得回來。
 */

const V2_PREFIX = 'LUNATV-BK-v2:';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
// 與 password.ts 的 scrypt 參數一致（記憶體需求約 16MB，在預設 maxmem 內）
const SCRYPT_COST = 16384; // N
const BLOCK_SIZE = 8; // r
const PARALLELIZATION = 1; // p

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  });
}

export class SimpleCrypto {
  /**
   * 加密資料（一律輸出 v2 格式）
   * @param data 要加密的資料
   * @param password 加密密碼
   * @returns 加密後的字符串
   */
  static encrypt(data: string, password: string): string {
    try {
      const salt = randomBytes(SALT_LENGTH);
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(
        'aes-256-gcm',
        deriveKey(password, salt),
        iv
      );
      const ciphertext = Buffer.concat([
        cipher.update(data, 'utf8'),
        cipher.final(),
      ]);

      return (
        V2_PREFIX +
        Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]).toString(
          'base64'
        )
      );
    } catch (error) {
      throw new Error('加密失敗');
    }
  }

  /**
   * 解密資料（自動辨識 v2 與舊格式）
   * @param encryptedData 加密的資料
   * @param password 解密密碼
   * @returns 解密後的字符串
   */
  static decrypt(encryptedData: string, password: string): string {
    if (encryptedData.startsWith(V2_PREFIX)) {
      return this.decryptV2(encryptedData.slice(V2_PREFIX.length), password);
    }
    return this.decryptLegacy(encryptedData, password);
  }

  private static decryptV2(payload: string, password: string): string {
    try {
      const raw = Buffer.from(payload, 'base64');
      if (raw.length <= SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH) {
        throw new Error('備份內容不完整');
      }

      let offset = 0;
      const salt = raw.subarray(offset, (offset += SALT_LENGTH));
      const iv = raw.subarray(offset, (offset += IV_LENGTH));
      const authTag = raw.subarray(offset, (offset += AUTH_TAG_LENGTH));
      const ciphertext = raw.subarray(offset);

      const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveKey(password, salt),
        iv
      );
      // 密碼錯誤或密文遭竄改時，final() 會因 authTag 不符而拋出
      decipher.setAuthTag(authTag);

      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString('utf8');
    } catch (error) {
      throw new Error('解密失敗，請檢查密碼是否正確');
    }
  }

  /**
   * 舊格式明文合理性（密碼錯誤時 AES 輸出偽隨機位元組，Utf8 偶爾非空亂碼）。
   * 接受兩種歷史形態：
   *   A) base64(gzip(JSON)) — 本 repo 自 v2.5.4 起的 export 契約
   *   B) 裸 JSON — 假想中更舊／上游時期備份；隨機亂碼幾乎不可能 JSON.parse 成功
   */
  private static isPlausibleLegacyPlaintext(plaintext: string): boolean {
    if (!plaintext) return false;

    // A) base64(gzip(...))
    if (plaintext.length >= 8 && /^[A-Za-z0-9+/=\s]+$/.test(plaintext)) {
      try {
        const raw = Buffer.from(plaintext.replace(/\s/g, ''), 'base64');
        if (raw.length >= 10 && raw[0] === 0x1f && raw[1] === 0x8b) {
          return true;
        }
      } catch {
        // fall through to JSON path
      }
    }

    // B) 裸 JSON
    const trimmed = plaintext.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        JSON.parse(trimmed);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  private static decryptLegacy(
    encryptedData: string,
    password: string
  ): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, password);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);

      if (!this.isPlausibleLegacyPlaintext(decrypted)) {
        // 密碼錯與「密碼對但格式不認得」無法可靠區分；訊息涵蓋兩者
        throw new Error('解密失敗：密碼不正確，或備份格式無法辨識');
      }

      return decrypted;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('解密失敗')) {
        throw error;
      }
      throw new Error('解密失敗：密碼不正確，或備份格式無法辨識');
    }
  }

  /**
   * 驗證密碼是否能正確解密資料
   * @param encryptedData 加密的資料
   * @param password 密碼
   * @returns 是否能正確解密
   */
  static canDecrypt(encryptedData: string, password: string): boolean {
    try {
      const decrypted = this.decrypt(encryptedData, password);
      return decrypted.length > 0;
    } catch {
      return false;
    }
  }
}
