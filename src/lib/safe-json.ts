export function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * \u5f9e\u5931\u6557\u7684\u56de\u61c9\u4e2d\u53d6\u51fa\u53ef\u8b80\u7684\u932f\u8aa4\u8a0a\u606f\u3002
 *
 * \u4e0d\u80fd\u76f4\u63a5\u5c0d\u932f\u8aa4\u56de\u61c9\u547c\u53eb response.json()\uff1aproxy \u5c0d /api/* \u7684\u9a57\u8b49\u5931\u6557\u56de\u7684\u662f
 * \u7d14\u6587\u5b57 'Unauthorized'\uff0c\u786c\u89e3\u6703\u62cb SyntaxError\uff0c\u756b\u9762\u4e0a\u5c31\u8b8a\u6210
 * \u300cUnexpected token 'U', "Unauthorized" is not valid JSON\u300d\u9019\u7a2e\u5c0d\u4f7f\u7528\u8005
 * \u6beb\u7121\u610f\u7fa9\u7684\u8a0a\u606f\uff0c\u53cd\u800c\u84cb\u6389\u771f\u6b63\u7684\u539f\u56e0\uff08\u767b\u5165\u904e\u671f\uff09\u3002
 */
export async function readErrorMessage(
  response: Response,
  fallback = '請求失敗'
): Promise<string> {
  let raw = '';
  try {
    raw = await response.text();
  } catch {
    if (response.status === 401) return '登入已過期，請重新登入';
    return fallback;
  }

  const trimmed = raw.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const message = (parsed as Record<string, unknown>).error;
      if (typeof message === 'string' && message.trim()) return message;
    }
  } catch {
    // 非 JSON：純文字 Unauthorized 才視為登入過期；其餘截斷後回傳
  }

  if (response.status === 401) return '登入已過期，請重新登入';
  if (!trimmed) return fallback;

  return trimmed.slice(0, 200);
}
