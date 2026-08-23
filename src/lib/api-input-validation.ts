import type { ParsedStorageKey } from './storage-key';
import { parseStorageKey } from './storage-key';

const SOURCE_MAX_LENGTH = 128;
const MEDIA_ID_MAX_LENGTH = 512;
const REMOTE_URL_MAX_LENGTH = 4096;
const STORAGE_KEY_MAX_LENGTH = SOURCE_MAX_LENGTH + MEDIA_ID_MAX_LENGTH + 1;
const SEARCH_QUERY_MAX_LENGTH = 200;
const TEXT_PARAM_MAX_LENGTH = 200;

const SOURCE_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MEDIA_ID_PATTERN = /^[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$/;
const NUMERIC_ID_PATTERN = /^\d{1,12}$/;
const UNSAFE_TEXT_CHARS_PATTERN = /[<>`\\]/;

export function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidApiSource(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const trimmed = value.trim();
  return trimmed.length <= SOURCE_MAX_LENGTH && SOURCE_PATTERN.test(trimmed);
}

export function isValidApiMediaId(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const trimmed = value.trim();
  return (
    trimmed.length <= MEDIA_ID_MAX_LENGTH && MEDIA_ID_PATTERN.test(trimmed)
  );
}

export function isValidApiRemoteUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const trimmed = value.trim();
  if (
    trimmed.length > REMOTE_URL_MAX_LENGTH ||
    hasControlChars(trimmed) ||
    !MEDIA_ID_PATTERN.test(trimmed)
  ) {
    return false;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidApiNumericId(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  return NUMERIC_ID_PATTERN.test(value.trim());
}

export function isValidApiStorageKey(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const trimmed = value.trim();
  if (trimmed.length > STORAGE_KEY_MAX_LENGTH) return false;

  const parsed = parseStorageKey(trimmed);
  if (!parsed) return false;

  return isValidApiSource(parsed.source) && isValidApiMediaId(parsed.id);
}

export function parseAndValidateApiStorageKey(
  value: unknown
): ParsedStorageKey | null {
  if (!isValidApiStorageKey(value)) return null;
  return parseStorageKey(value.trim());
}

export function isValidApiSearchQuery(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const trimmed = value.trim();
  return (
    trimmed.length <= SEARCH_QUERY_MAX_LENGTH &&
    !hasControlChars(trimmed) &&
    !UNSAFE_TEXT_CHARS_PATTERN.test(trimmed)
  );
}

export function isValidApiTextParam(
  value: unknown,
  maxLength = TEXT_PARAM_MAX_LENGTH
): value is string {
  if (!isNonEmptyString(value)) return false;
  const trimmed = value.trim();
  return (
    trimmed.length <= maxLength &&
    !hasControlChars(trimmed) &&
    !UNSAFE_TEXT_CHARS_PATTERN.test(trimmed)
  );
}

export async function readJsonObject<
  T extends Record<string, unknown> = Record<string, unknown>,
>(request: { json(): Promise<unknown> }): Promise<T | null> {
  try {
    const body = await request.json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }
    return body as T;
  } catch {
    return null;
  }
}

/** 一般使用者 API 不得讓客戶端指定要操作哪個帳號。 */
const USER_OVERRIDE_KEYS = ['user', 'username', 'userName', 'user_name'];

export function hasDisallowedUserOverride(
  request: { url?: string },
  body?: Record<string, unknown> | null
): boolean {
  let searchParams: URLSearchParams;
  try {
    searchParams = new URL(request.url || 'http://localhost/').searchParams;
  } catch {
    searchParams = new URLSearchParams();
  }
  for (const key of USER_OVERRIDE_KEYS) {
    if (searchParams.has(key)) return true;
    if (
      body &&
      Object.prototype.hasOwnProperty.call(body, key) &&
      body[key] != null
    ) {
      return true;
    }
  }
  return false;
}
