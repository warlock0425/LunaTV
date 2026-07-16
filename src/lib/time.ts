/**
 * 時間格式轉換函數
 * 處理形如 "20250824000000 +0800" 的時間格式
 */
export function parseCustomTimeFormat(timeStr: string): Date {
  // 如果已經是標準格式，直接返回
  if (timeStr.includes('T') || timeStr.includes('-')) {
    return new Date(timeStr);
  }

  // 處理 "20250824000000 +0800" 格式
  // 格式說明：YYYYMMDDHHMMSS +ZZZZ
  const match = timeStr.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})$/
  );

  if (match) {
    const [, year, month, day, hour, minute, second, timezone] = match;

    // 建立 ISO 格式的時間字串
    const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${timezone}`;
    return new Date(isoString);
  }

  // 如果格式不匹配，嘗試其他常見格式
  return new Date(timeStr);
}

/**
 * 格式化時間為 HH:MM 格式
 */
export function formatTimeToHHMM(timeString: string): string {
  try {
    const date = parseCustomTimeFormat(timeString);
    if (isNaN(date.getTime())) {
      return timeString; // 如果解析失敗，返回原始字串
    }
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return timeString;
  }
}
