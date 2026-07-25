'use client';

import { CURRENT_VERSION } from '@/lib/version';

// 版本檢查結果枚舉
export enum UpdateStatus {
  HAS_UPDATE = 'has_update', // 有新版本
  NO_UPDATE = 'no_update', // 無新版本
  FETCH_FAILED = 'fetch_failed', // 取得失敗
}

// 遠程版本檢查URL設定
const VERSION_CHECK_URLS = [
  'https://raw.githubusercontent.com/Berserker8888/LunaTV/main/VERSION.txt',
];

/**
 * 檢查是否有新版本可用
 * @returns Promise<UpdateStatus> - 返回版本檢查狀態
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  try {
    // 嘗試從主要URL取得版本資訊
    for (const url of VERSION_CHECK_URLS) {
      const version = await fetchVersionFromUrl(url);
      if (version) {
        return compareVersions(version);
      }
    }

    // 如果主要URL失敗，嘗試備用URL
    // 如果兩個URL都失敗，返回取得失敗狀態
    return UpdateStatus.FETCH_FAILED;
  } catch (error) {
    console.error('版本檢查失敗:', error);
    return UpdateStatus.FETCH_FAILED;
  }
}

/**
 * 從指定URL取得版本資訊
 * @param url - 版本資訊URL
 * @returns Promise<string | null> - 版本字符串或null
 */
async function fetchVersionFromUrl(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    // 新增時間戳參數以避免快取
    const timestamp = Date.now();
    const urlWithTimestamp = url.includes('?')
      ? `${url}&_t=${timestamp}`
      : `${url}?_t=${timestamp}`;

    const response = await fetch(urlWithTimestamp, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/plain',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const version = await response.text();
    return version.trim();
  } catch (error) {
    console.warn(`從 ${url} 取得版本資訊失敗:`, error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 比較版本號
 * @param remoteVersion - 遠程版本號
 * @returns UpdateStatus - 返回版本比較結果
 */
export function compareVersions(remoteVersion: string): UpdateStatus {
  // 如果版本號相同，無需更新
  const cleanCurrent = CURRENT_VERSION.startsWith('v')
    ? CURRENT_VERSION.substring(1)
    : CURRENT_VERSION;
  const cleanRemote = remoteVersion.startsWith('v')
    ? remoteVersion.substring(1)
    : remoteVersion;

  if (cleanRemote === cleanCurrent) {
    return UpdateStatus.NO_UPDATE;
  }

  try {
    // 解析版本號為數字數組 [X, Y, Z]
    const currentParts = cleanCurrent.split('.').map((part) => {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0) {
        throw new Error(`無效的版本號格式: ${CURRENT_VERSION}`);
      }
      return num;
    });

    const remoteParts = cleanRemote.split('.').map((part) => {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0) {
        throw new Error(`無效的版本號格式: ${remoteVersion}`);
      }
      return num;
    });

    // 標準化版本號到3個部分
    const normalizeVersion = (parts: number[]) => {
      if (parts.length >= 3) {
        return parts.slice(0, 3); // 取前三個元素
      } else {
        // 不足3個的部分補0
        const normalized = [...parts];
        while (normalized.length < 3) {
          normalized.push(0);
        }
        return normalized;
      }
    };

    const normalizedCurrent = normalizeVersion(currentParts);
    const normalizedRemote = normalizeVersion(remoteParts);

    // 逐級比較版本號
    for (let i = 0; i < 3; i++) {
      if (normalizedRemote[i] > normalizedCurrent[i]) {
        return UpdateStatus.HAS_UPDATE;
      } else if (normalizedRemote[i] < normalizedCurrent[i]) {
        return UpdateStatus.NO_UPDATE;
      }
      // 如果當前級別相等，繼續比較下一級
    }

    // 所有級別都相等，無需更新
    return UpdateStatus.NO_UPDATE;
  } catch (error) {
    console.error('版本號比較失敗:', error);
    // 如果版本號格式無效，回退到字符串比較
    return remoteVersion !== CURRENT_VERSION
      ? UpdateStatus.HAS_UPDATE
      : UpdateStatus.NO_UPDATE;
  }
}
