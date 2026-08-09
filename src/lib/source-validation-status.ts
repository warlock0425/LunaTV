/**
 * 片源檢測結果的「該怎麼處理」判讀（純資料，無 I/O）。
 *
 * 抽成獨立模組的原因：source-validation.ts 會 import config／downstream／
 * url-safety（伺服器端、含對外抓取），而管理端片源列表是 client component。
 * 直接 import 那支會把整套檢測引擎打進瀏覽器 bundle，所以判讀邏輯放這裡，
 * 伺服器與瀏覽器兩邊共用同一份規則。
 */

/**
 * describeSourceValidation 需要的最小欄位。
 *
 * 刻意用結構型別而非 import SourceValidationResult：後者帶著整個伺服器模組。
 * 兩邊的字面量若哪天漂掉，source-validation.ts 的委派呼叫會編譯失敗，
 * 所以這份重複有 tsc 守著。
 */
export interface SourceValidationSnapshot {
  /**
   * validating 是後台才有的暫態（伺服器不會送），列在這裡是因為管理端會拿
   * 檢測中的列項來問建議；它一律回 null——還沒測完就不該下結論。
   */
  status: 'valid' | 'partial' | 'no_results' | 'invalid' | 'validating';
  levels?: {
    search?: 'pass' | 'fail' | 'skip';
    detail?: 'pass' | 'fail' | 'skip';
    playable?: 'pass' | 'fail' | 'skip';
  };
}

export interface SourceDisableSuggestion {
  suggest: boolean;
  /**
   * 徽章用短標籤。後台的狀態欄是 whitespace-nowrap 的窄格，只能放幾個字，
   * 所以診斷結果要濃縮到這裡；完整建議放 reason（tooltip）。
   */
  label: string;
  reason: string;
}

/**
 * 把「部分通過」拆成站長真的能據以行動的理由。
 *
 * 後台原本只顯示「建議關注」，但 detail 失敗與 playable 失敗的處理方式相反：
 * 前者多半是來源的詳情接口壞了（該停用），後者常常只是這次的測試關鍵詞剛好
 * 沒片（換個詞重測即可）。同一個標籤看不出差別，站長只能一個一個自己試。
 *
 * 回 null 表示沒有要建議的事：valid、no_results，或尚未檢測。
 */
export function describeSourceValidation(
  result: SourceValidationSnapshot | null | undefined
): SourceDisableSuggestion | null {
  if (!result) return null;

  if (result.status === 'invalid') {
    return {
      suggest: true,
      label: '建議停用',
      reason: '連線失敗，建議檢查 API 或暫時停用',
    };
  }
  if (result.status === 'partial' && result.levels?.detail === 'fail') {
    return {
      suggest: true,
      label: '解集數失敗',
      reason: '可搜但無法解析集數，建議檢查詳情接口',
    };
  }
  if (result.status === 'partial' && result.levels?.playable === 'fail') {
    return {
      suggest: true,
      label: '試播失敗',
      reason: '可搜可解但播放抽樣失敗，建議換關鍵詞重測或作備援',
    };
  }
  return null;
}
