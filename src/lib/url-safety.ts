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
const dnsSafetyCache = new Map<
  string,
  { expiresAt: number; addresses: Array<{ address: string }> }
>();
const pinnedAgentCache = new Map<string, Agent>();

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
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
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

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get('location');
    response.body?.cancel();
    if (!location) {
      return response;
    }

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
    'application/octet-stream',
  ]);

  return allowedTypes.has(normalizedType) ? normalizedType : null;
}
