export type ServerStorageType =
  'localstorage' | 'redis' | 'upstash' | 'kvrocks';

export interface StorageRuntimeStatus {
  type: ServerStorageType;
  configured: boolean;
  message: string;
  missing: string[];
}

type EnvLike = Partial<
  Record<
    | 'STORAGE_TYPE'
    | 'NEXT_PUBLIC_STORAGE_TYPE'
    | 'REDIS_URL'
    | 'UPSTASH_URL'
    | 'UPSTASH_TOKEN'
    | 'KVROCKS_URL',
    string
  >
>;

const STORAGE_TYPES = new Set<ServerStorageType>([
  'localstorage',
  'redis',
  'upstash',
  'kvrocks',
]);

export function normalizeStorageType(value: unknown): ServerStorageType {
  return typeof value === 'string' &&
    STORAGE_TYPES.has(value as ServerStorageType)
    ? (value as ServerStorageType)
    : 'localstorage';
}

export function getServerStorageType(env?: EnvLike): ServerStorageType {
  const source = (env || process.env) as EnvLike;
  const rawType = source.STORAGE_TYPE || source.NEXT_PUBLIC_STORAGE_TYPE;
  return normalizeStorageType(rawType);
}

function getMissingEnv(env: EnvLike, keys: string[]): string[] {
  return keys.filter((key) => !env[key as keyof EnvLike]);
}

export function getStorageRuntimeStatus(env?: EnvLike): StorageRuntimeStatus {
  const source = (env || process.env) as EnvLike;
  const type = getServerStorageType(source);

  switch (type) {
    case 'redis': {
      const missing = getMissingEnv(source, ['REDIS_URL']);
      return {
        type,
        configured: missing.length === 0,
        message:
          missing.length === 0
            ? 'Redis storage configured'
            : `Missing required env: ${missing.join(', ')}`,
        missing,
      };
    }
    case 'upstash': {
      const missing = getMissingEnv(source, ['UPSTASH_URL', 'UPSTASH_TOKEN']);
      return {
        type,
        configured: missing.length === 0,
        message:
          missing.length === 0
            ? 'Upstash storage configured'
            : `Missing required env: ${missing.join(', ')}`,
        missing,
      };
    }
    case 'kvrocks': {
      const missing = getMissingEnv(source, ['KVROCKS_URL']);
      return {
        type,
        configured: missing.length === 0,
        message:
          missing.length === 0
            ? 'Kvrocks storage configured'
            : `Missing required env: ${missing.join(', ')}`,
        missing,
      };
    }
    case 'localstorage':
    default:
      return {
        type: 'localstorage',
        configured: true,
        message: 'localStorage mode',
        missing: [],
      };
  }
}
