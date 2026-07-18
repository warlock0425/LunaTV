import { db } from './db';
import { getServerStorageType } from './storage-runtime';

// A wrapper to align with the storage.hgetall and storage.hdel methods in the route
export const storage = {
  hgetall: async (key: string): Promise<Record<string, string>> => {
    // Map user:history:${mockUserId} to u:${mockUserId}:pr
    let actualKey = key;
    const match = key.match(/^user:history:(.+)$/);
    if (match) {
      actualKey = `u:${match[1]}:pr`;
    }

    // 伺服器端優先使用 STORAGE_TYPE（不帶 NEXT_PUBLIC_），避免在客戶端 bundle 暴露後端類型
    const storageType = getServerStorageType();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storageImpl = (db as any).storage;
    if (!storageImpl || storageType === 'localstorage') {
      // localStorage 只存在於瀏覽器端；伺服器端 API route 呼叫此方法時直接回傳空物件
      if (typeof window === 'undefined') return {};
      const raw = localStorage.getItem(actualKey);
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? parsed : {};
      } catch {
        return {};
      }
    }

    const client = storageImpl.client;
    if (!client) return {};

    if (storageType === 'upstash') {
      // Upstash uses hgetall
      const res = await client.hgetall(actualKey);
      if (!res) return {};
      // convert object values to string if they are parsed objects
      const finalRes: Record<string, string> = {};
      for (const [k, v] of Object.entries(res)) {
        if (v === null || v === undefined) {
          finalRes[k] = '';
        } else {
          finalRes[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
        }
      }
      return finalRes;
    } else {
      // redis and kvrocks use hGetAll
      const res = await client.hGetAll(actualKey);
      return res || {};
    }
  },

  hdel: async (key: string, field: string): Promise<void> => {
    let actualKey = key;
    const match = key.match(/^user:history:(.+)$/);
    if (match) {
      actualKey = `u:${match[1]}:pr`;
    }

    const storageType = getServerStorageType();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storageImpl = (db as any).storage;
    if (!storageImpl || storageType === 'localstorage') {
      // localStorage 只存在於瀏覽器端；伺服器端返回即可，不需操作
      if (typeof window === 'undefined') return;
      const raw = localStorage.getItem(actualKey);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          delete parsed[field];
          localStorage.setItem(actualKey, JSON.stringify(parsed));
        }
      } catch {
        /* ignore */
      }
      return;
    }

    const client = storageImpl.client;
    if (!client) return;

    if (storageType === 'upstash') {
      await client.hdel(actualKey, field);
    } else {
      await client.hDel(actualKey, field);
    }
  },
};
