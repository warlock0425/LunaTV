import CryptoJS from 'crypto-js';

/**
 * 簡單的對稱加密工具
 * 使用 AES 加密算法
 */
export class SimpleCrypto {
  /**
   * 加密資料
   * @param data 要加密的資料
   * @param password 加密密碼
   * @returns 加密後的字符串
   */
  static encrypt(data: string, password: string): string {
    try {
      const encrypted = CryptoJS.AES.encrypt(data, password).toString();
      return encrypted;
    } catch (error) {
      throw new Error('加密失敗');
    }
  }

  /**
   * 解密資料
   * @param encryptedData 加密的資料
   * @param password 解密密碼
   * @returns 解密後的字符串
   */
  static decrypt(encryptedData: string, password: string): string {
    try {
      const bytes = CryptoJS.AES.decrypt(encryptedData, password);
      const decrypted = bytes.toString(CryptoJS.enc.Utf8);

      if (!decrypted) {
        throw new Error('解密失敗，請檢查密碼是否正確');
      }

      return decrypted;
    } catch (error) {
      throw new Error('解密失敗，請檢查密碼是否正確');
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
