import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

import { setBoundedMapValue } from './bounded-map';

export {
  readResponseBytesWithLimit,
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
  RemoteResponseTooLargeError,
} from './response-limit';

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fd00:/i,
  /^fe[89ab][0-9a-f]:/i,
];
const DNS_SAFETY_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_DNS_SAFETY_CACHE_ENTRIES = 1000;
const MAX_PINNED_AGENTS = 100;
/**
 * DNS 查詢逾時。
 *
 * node 的 dns.lookup 走 libuv 執行緒池（預設僅 4 條），既不吃 AbortSignal
 * 也沒有內建逾時——呼叫端設的 AbortController 完全管不到這一段。解析器一慢，
 * 卡住的查詢會佔滿執行緒池，連帶拖垮同行程中所有需要執行緒池的工作
 * （檔案 I/O、gzip、scrypt 密碼驗證）。這裡自己加上限，讓單張圖片失敗，
 * 而不是整站一起等。
 */
const DNS_LOOKUP_TIMEOUT_MS = 5000;
/**
 * 解析失敗的負面快取，避免死掉的主機每次請求都再賠上一次逾時。
 *
 * 刻意取短（10 秒）：這台部署主機的 DNS 是「慢但可用」，逾時有機會誤判到
 * 正常的圖床。快取太久等於讓一次瞬斷把好主機停用一段時間，海報會整批破圖。
 * 10 秒足以擋掉單次頁面載入內的重複重試，又能讓瞬斷很快恢復。
 */
const DNS_FAILURE_CACHE_TTL_MS = 10 * 1000;
const MAX_DNS_FAILURE_CACHE_ENTRIES = 500;
const dnsSafetyCache = new Map<
  string,
  { expiresAt: number; addresses: Array<{ address: string }> }
>();
const dnsFailureCache = new Map<string, number>();
/**
 * 同一主機名的並發查詢去重。
 *
 * 首頁一次載入數十張海報，同一個圖床冷快取時會同時發出多次「一模一樣」的
 * 解析請求，每一次都吃掉一個執行緒池名額。共用同一個 Promise 後，N 次併發
 * 只會實際查詢一次。
 */
const inFlightLookups = new Map<string, Promise<Array<{ address: string }>>>();
const pinnedAgentCache = new Map<string, Agent>();

class DnsLookupTimeoutError extends Error {
  constructor(hostname: string) {
    super(`DNS lookup timed out: ${hostname}`);
    this.name = 'DnsLookupTimeoutError';
  }
}

function lookupWithTimeout(
  hostname: string
): Promise<Array<{ address: string }>> {
  const existing = inFlightLookups.get(hostname);
  if (existing) return existing;

  const lookupPromise = lookup(hostname, { all: true, verbatim: true });
  // 逾時後底層的 getaddrinfo 仍會在執行緒池裡跑到完才 settle，而那時 race
  // 早已 reject、沒有人再接它。先掛一個吞掉錯誤的 handler，否則會變成
  // 未處理的 promise rejection。
  lookupPromise.catch(() => undefined);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.race([
    lookupPromise,
    new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new DnsLookupTimeoutError(hostname)),
        DNS_LOOKUP_TIMEOUT_MS
      );
    }),
  ]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
    inFlightLookups.delete(hostname);
  });

  inFlightLookups.set(hostname, pending);
  return pending;
}

function getNormalizedHostname(parsed: URL): string {
  return parsed.hostname.replace(/^\[|\]$/g, '');
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function isPrivateResolvedAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  const ipType = isIP(normalized);

  if (ipType === 4) {
    return isPrivateIpv4(normalized);
  }

  if (ipType === 6) {
    const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mappedIpv4) {
      return isPrivateIpv4(mappedIpv4[1]);
    }

    const mappedHex = normalized.match(
      /::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
    );
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      const dotted = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
      return isPrivateIpv4(dotted);
    }

    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab][0-9a-f]:/i.test(normalized)
    );
  }

  return false;
}

type ResolvedAddress = { address: string; family: 4 | 6 };

async function resolveSafeRemoteAddresses(
  parsed: URL
): Promise<ResolvedAddress[]> {
  const hostname = getNormalizedHostname(parsed);

  if (isIP(hostname)) {
    if (isPrivateResolvedAddress(hostname)) {
      throw new UnsafeRemoteUrlError('Unsafe remote address');
    }
    return [{ address: hostname, family: isIP(hostname) as 4 | 6 }];
  }

  const now = Date.now();
  const cached = dnsSafetyCache.get(hostname);
  let addresses = cached && cached.expiresAt > now ? cached.addresses : null;

  if (!addresses) {
    const failedUntil = dnsFailureCache.get(hostname);
    if (failedUntil !== undefined) {
      if (failedUntil > now) {
        throw new UnsafeRemoteUrlError('Unable to resolve remote host');
      }
      dnsFailureCache.delete(hostname);
    }

    try {
      addresses = await lookupWithTimeout(hostname);
    } catch {
      setBoundedMapValue(
        dnsFailureCache,
        hostname,
        now + DNS_FAILURE_CACHE_TTL_MS,
        MAX_DNS_FAILURE_CACHE_ENTRIES
      );
      throw new UnsafeRemoteUrlError('Unable to resolve remote host');
    }
  }

  if (
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateResolvedAddress(entry.address))
  ) {
    throw new UnsafeRemoteUrlError('Unsafe resolved remote address');
  }

  if (!cached || cached.expiresAt <= now) {
    setBoundedMapValue(
      dnsSafetyCache,
      hostname,
      {
        expiresAt: now + DNS_SAFETY_CACHE_TTL_MS,
        addresses,
      },
      MAX_DNS_SAFETY_CACHE_ENTRIES
    );
  }

  // IPv4 優先：許多 VPS 沒有 IPv6 出口，若網域（如 Cloudflare）AAAA 排前面，
  // 釘死在 IPv6 會直接連線失敗；保留全部位址讓連線層可依序退回。
  return [...addresses]
    .sort(
      (a, b) =>
        (isIP(a.address) === 4 ? 0 : 1) - (isIP(b.address) === 4 ? 0 : 1)
    )
    .map((entry) => ({
      address: entry.address,
      family: isIP(entry.address) as 4 | 6,
    }));
}

function getPinnedAgent(hostname: string, targets: ResolvedAddress[]): Agent {
  const key = `${hostname}:${targets.map((t) => t.address).join(',')}`;
  const cached = pinnedAgentCache.get(key);
  if (cached) return cached;

  const agent = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) {
          callback(
            null,
            targets.map((t) => ({ address: t.address, family: t.family }))
          );
        } else {
          callback(null, targets[0].address, targets[0].family);
        }
      },
    },
  });
  pinnedAgentCache.set(key, agent);
  while (pinnedAgentCache.size > MAX_PINNED_AGENTS) {
    const oldestKey = pinnedAgentCache.keys().next().value as
      string | undefined;
    if (!oldestKey) break;
    const evicted = pinnedAgentCache.get(oldestKey);
    pinnedAgentCache.delete(oldestKey);
    void evicted?.close();
  }
  return agent;
}

/** 帶 Location 的重導向狀態碼（304 / 300 不在其列，它們不是重導向） */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class UnsafeRemoteUrlError extends Error {
  constructor(message = 'Unsafe remote URL') {
    super(message);
    this.name = 'UnsafeRemoteUrlError';
  }
}

export function parseSafeRemoteUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const hostname = getNormalizedHostname(parsed);
    if (PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isSafeRemoteUrl(url: string): boolean {
  return parseSafeRemoteUrl(url) !== null;
}

export async function fetchSafeRemoteUrl(
  url: string,
  init?: RequestInit,
  maxRedirects = 5
): Promise<Response> {
  let currentUrl = parseSafeRemoteUrl(url);
  if (!currentUrl) {
    throw new UnsafeRemoteUrlError();
  }

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const targets = await resolveSafeRemoteAddresses(currentUrl);
    const dispatcher = getPinnedAgent(
      getNormalizedHostname(currentUrl),
      targets
    );

    const response = await fetch(currentUrl.toString(), {
      ...init,
      redirect: 'manual',
      dispatcher,
    } as RequestInit & { dispatcher: Agent });

    // 只跟隨真正帶 Location 的重導向。3xx 不等於重導向——304 Not Modified、
    // 300 Multiple Choices 都在這個區間卻沒有 Location，原本會被當成重導向
    // 處理、body 先被 cancel 掉才回傳，呼叫端拿到的是讀不動的空殼。
    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    // 重導向狀態碼卻沒有 Location 是壞掉的回應，無從跟隨，當成錯誤處理。
    // 呼叫端本來就都有接 UnsafeRemoteUrlError。
    if (!location) {
      void response.body?.cancel().catch(() => undefined);
      throw new UnsafeRemoteUrlError('Redirect without Location header');
    }
    void response.body?.cancel().catch(() => undefined);

    const nextUrl = parseSafeRemoteUrl(
      new URL(location, currentUrl).toString()
    );
    if (!nextUrl) {
      throw new UnsafeRemoteUrlError('Unsafe redirect URL');
    }
    currentUrl = nextUrl;
  }

  throw new UnsafeRemoteUrlError('Too many redirects');
}

export function getSafeImageContentType(
  contentType: string | null
): string | null {
  if (!contentType) {
    return null;
  }

  const normalizedType = contentType.split(';')[0].trim().toLowerCase();
  const allowedTypes = new Set([
    'image/avif',
    'image/bmp',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/x-icon',
    'image/vnd.microsoft.icon',
  ]);

  return allowedTypes.has(normalizedType) ? normalizedType : null;
}
