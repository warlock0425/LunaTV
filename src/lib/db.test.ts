import { DbManager, StorageLockTimeoutError } from './db';
import { IStorage, PlayRecord } from './types';

function createRecord(saveTime: number, playTime: number): PlayRecord {
  return {
    title: '測試影片',
    source_name: '測試來源',
    cover: '',
    year: '2026',
    index: 1,
    total_episodes: 12,
    play_time: playTime,
    total_time: 1200,
    save_time: saveTime,
    search_title: '測試影片',
  };
}

function createMemoryStorage() {
  const records: Record<string, Record<string, PlayRecord>> = {};
  const storage = {
    async getPlayRecord(userName: string, key: string) {
      return records[userName]?.[key] || null;
    },
    async getAllPlayRecords(userName: string) {
      return { ...(records[userName] || {}) };
    },
    async setPlayRecord(userName: string, key: string, record: PlayRecord) {
      records[userName] ||= {};
      records[userName][key] = record;
    },
    async deletePlayRecord(userName: string, key: string) {
      delete records[userName]?.[key];
    },
    async deleteAllPlayRecords(userName: string) {
      records[userName] = {};
    },
  } as IStorage;

  return { records, storage };
}

describe('DbManager play-record serialization', () => {
  it('keeps the newest progress when an older request arrives later', async () => {
    const { records, storage } = createMemoryStorage();
    const manager = new DbManager(storage);

    await manager.savePlayRecord('user', 'source', '1', createRecord(200, 200));
    await manager.savePlayRecord('user', 'source', '1', createRecord(100, 100));

    expect(records.user['source+1']).toEqual(
      expect.objectContaining({ save_time: 200, play_time: 200 })
    );
  });

  it('serializes read-check-write mutations across manager instances', async () => {
    const records: Record<string, Record<string, PlayRecord>> = {};
    const locks = new Map<string, { token: string; expiresAt: number }>();
    const successfulOwners: string[] = [];
    const releasedOwners: string[] = [];
    let releaseFirstRead!: () => void;
    let markFirstReadStarted!: () => void;
    const firstReadStarted = new Promise<void>((resolve) => {
      markFirstReadStarted = resolve;
    });
    const firstReadGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let shouldBlockFirstRead = true;

    const storage = {
      async acquireLock(key: string, ownerToken: string, ttlMs: number) {
        const current = locks.get(key);
        if (current && current.expiresAt > Date.now()) return false;
        locks.set(key, { token: ownerToken, expiresAt: Date.now() + ttlMs });
        successfulOwners.push(ownerToken);
        return true;
      },
      async releaseLock(key: string, ownerToken: string) {
        const current = locks.get(key);
        if (!current || current.token !== ownerToken) return false;
        locks.delete(key);
        releasedOwners.push(ownerToken);
        return true;
      },
      async renewLock(key: string, ownerToken: string, ttlMs: number) {
        const current = locks.get(key);
        if (!current || current.token !== ownerToken) return false;
        current.expiresAt = Date.now() + ttlMs;
        return true;
      },
      async getPlayRecord(userName: string, key: string) {
        if (shouldBlockFirstRead) {
          shouldBlockFirstRead = false;
          markFirstReadStarted();
          await firstReadGate;
        }
        return records[userName]?.[key] || null;
      },
      async getAllPlayRecords(userName: string) {
        return { ...(records[userName] || {}) };
      },
      async setPlayRecord(userName: string, key: string, record: PlayRecord) {
        records[userName] ||= {};
        records[userName][key] = record;
      },
      async deletePlayRecord(userName: string, key: string) {
        delete records[userName]?.[key];
      },
    } as IStorage;

    const firstManager = new DbManager(storage);
    const secondManager = new DbManager(storage);
    const newerWrite = firstManager.savePlayRecord(
      'user',
      'source',
      '1',
      createRecord(200, 200)
    );
    await firstReadStarted;

    const olderWrite = secondManager.savePlayRecord(
      'user',
      'source',
      '1',
      createRecord(100, 100)
    );
    releaseFirstRead();
    await Promise.all([newerWrite, olderWrite]);

    expect(records.user['source+1']).toEqual(
      expect.objectContaining({ save_time: 200, play_time: 200 })
    );
    expect(new Set(successfulOwners).size).toBe(2);
    expect(releasedOwners).toEqual(successfulOwners);
  });

  it('fails instead of mutating without a distributed lock after timeout', async () => {
    jest.useFakeTimers();
    try {
      const getAllPlayRecords = jest.fn().mockResolvedValue({});
      const releaseLock = jest.fn().mockResolvedValue(true);
      const storage = {
        acquireLock: jest.fn().mockResolvedValue(false),
        renewLock: jest.fn().mockResolvedValue(true),
        releaseLock,
        getAllPlayRecords,
      } as unknown as IStorage;
      const manager = new DbManager(storage);

      const savePromise = manager.savePlayRecord(
        'user',
        'source',
        '1',
        createRecord(100, 100)
      );
      const rejection = expect(savePromise).rejects.toBeInstanceOf(
        StorageLockTimeoutError
      );

      await jest.advanceTimersByTimeAsync(5_100);
      await rejection;
      expect(getAllPlayRecords).not.toHaveBeenCalled();
      expect(releaseLock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases a lock that arrives after the acquire timeout', async () => {
    jest.useFakeTimers();
    try {
      let resolveAcquire!: (value: boolean) => void;
      const acquireLock = jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            resolveAcquire = resolve;
          })
      );
      const releaseLock = jest.fn().mockResolvedValue(true);
      const getAllPlayRecords = jest.fn().mockResolvedValue({});
      const storage = {
        acquireLock,
        renewLock: jest.fn(),
        releaseLock,
        getAllPlayRecords,
      } as unknown as IStorage;
      const manager = new DbManager(storage);

      const savePromise = manager.savePlayRecord(
        'user',
        'source',
        '1',
        createRecord(100, 100)
      );
      const rejection = expect(savePromise).rejects.toBeInstanceOf(
        StorageLockTimeoutError
      );

      await jest.advanceTimersByTimeAsync(5_100);
      await rejection;
      expect(releaseLock).not.toHaveBeenCalled();
      expect(getAllPlayRecords).not.toHaveBeenCalled();

      resolveAcquire(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(releaseLock).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('renews the lease while a mutation runs longer than its TTL', async () => {
    jest.useFakeTimers();
    try {
      let lock: { token: string; expiresAt: number } | null = null;
      const renewLock = jest.fn(
        async (_key: string, ownerToken: string, ttlMs: number) => {
          if (
            !lock ||
            lock.token !== ownerToken ||
            lock.expiresAt <= Date.now()
          ) {
            return false;
          }
          lock.expiresAt = Date.now() + ttlMs;
          return true;
        }
      );
      const storage = {
        async acquireLock(_key: string, ownerToken: string, ttlMs: number) {
          lock = { token: ownerToken, expiresAt: Date.now() + ttlMs };
          return true;
        },
        renewLock,
        async releaseLock(_key: string, ownerToken: string) {
          if (!lock || lock.token !== ownerToken) return false;
          lock = null;
          return true;
        },
        async getPlayRecord() {
          await new Promise((resolve) => setTimeout(resolve, 65_000));
          return null;
        },
        async getAllPlayRecords() {
          return {};
        },
        async setPlayRecord() {},
        async deletePlayRecord() {},
      } as unknown as IStorage;
      const manager = new DbManager(storage);

      const savePromise = manager.savePlayRecord(
        'user',
        'source',
        '1',
        createRecord(100, 100)
      );
      await jest.advanceTimersByTimeAsync(65_100);

      await expect(savePromise).resolves.toBeUndefined();
      expect(renewLock).toHaveBeenCalledTimes(6);
      expect(lock).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('serializes concurrent writes for the same user', async () => {
    const { records, storage } = createMemoryStorage();
    const manager = new DbManager(storage);

    await Promise.all([
      manager.savePlayRecord('user', 'source', '1', createRecord(100, 100)),
      manager.savePlayRecord('user', 'source', '1', createRecord(200, 200)),
    ]);

    expect(records.user['source+1']).toEqual(
      expect.objectContaining({ save_time: 200, play_time: 200 })
    );
  });

  it('does not restore an older source after a newer source was saved', async () => {
    const { records, storage } = createMemoryStorage();
    const manager = new DbManager(storage);

    await manager.savePlayRecord(
      'user',
      'new-source',
      '2',
      createRecord(200, 200)
    );
    await manager.savePlayRecord(
      'user',
      'old-source',
      '1',
      createRecord(100, 100)
    );

    expect(records.user['new-source+2']).toEqual(
      expect.objectContaining({ save_time: 200, play_time: 200 })
    );
    expect(records.user['old-source+1']).toEqual(
      expect.objectContaining({ save_time: 100, play_time: 100 })
    );
  });

  it('deletePlayRecordsByTitle only removes exact title matches', async () => {
    const { records, storage } = createMemoryStorage();
    const manager = new DbManager(storage);

    await manager.savePlayRecord('user', 'a', '1', {
      ...createRecord(100, 10),
      title: '一',
      source_name: 'A',
    });
    await manager.savePlayRecord('user', 'a', '2', {
      ...createRecord(100, 10),
      title: '一生一世',
      source_name: 'A',
    });
    await manager.savePlayRecord('user', 'b', '3', {
      ...createRecord(100, 10),
      title: '一',
      source_name: 'B',
    });

    await manager.deletePlayRecordsByTitle('user', '一', 'A');

    expect(records.user['a+1']).toBeUndefined();
    expect(records.user['a+2']).toEqual(
      expect.objectContaining({ title: '一生一世' })
    );
    expect(records.user['b+3']).toEqual(
      expect.objectContaining({ title: '一' })
    );
  });

  it('updatePlayRecordMetadata only patches the same source+id and keeps progress', async () => {
    const { records, storage } = createMemoryStorage();
    const manager = new DbManager(storage);

    await manager.savePlayRecord('user', 'keep', '1', {
      ...createRecord(100, 40),
      title: '舊標題',
      cover: 'old.jpg',
      total_episodes: 8,
    });
    await manager.savePlayRecord('user', 'other', '9', {
      ...createRecord(200, 200),
      title: '另一部片',
      year: '2019',
    });

    const updated = await manager.updatePlayRecordMetadata(
      'user',
      'keep',
      '1',
      {
        title: '新標題',
        cover: 'new.jpg',
        year: '2027',
        total_episodes: 12,
      }
    );

    expect(updated).toBe(true);
    expect(records.user['keep+1']).toEqual(
      expect.objectContaining({
        title: '新標題',
        cover: 'new.jpg',
        year: '2027',
        total_episodes: 12,
        play_time: 40,
        save_time: 100,
        index: 1,
      })
    );
    expect(records.user['other+9']).toEqual(
      expect.objectContaining({ save_time: 200, play_time: 200 })
    );
  });

  it('updatePlayRecordMetadata skips missing keys and non-increasing episode counts', async () => {
    const { storage } = createMemoryStorage();
    const manager = new DbManager(storage);

    expect(
      await manager.updatePlayRecordMetadata('user', 'missing', '1', {
        total_episodes: 12,
      })
    ).toBe(false);

    await manager.savePlayRecord('user', 'keep', '1', {
      ...createRecord(100, 40),
      total_episodes: 12,
    });

    expect(
      await manager.updatePlayRecordMetadata('user', 'keep', '1', {
        total_episodes: 12,
      })
    ).toBe(false);
    expect(
      await manager.updatePlayRecordMetadata('user', 'keep', '1', {
        total_episodes: 8,
      })
    ).toBe(false);
  });
});

describe('DbManager migration gates', () => {
  it('waits for migration before deleting favorites or reading skip configs', async () => {
    const deleteFavorite = jest.fn();
    const getSkipConfig = jest.fn();
    const storage = {
      migrateData: jest.fn().mockRejectedValue(new Error('migration failed')),
      deleteFavorite,
      getSkipConfig,
    } as unknown as IStorage;
    const manager = new DbManager(storage);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(manager.deleteFavorite('user', 'source', '1')).rejects.toThrow(
      'migration failed'
    );
    await expect(manager.getSkipConfig('user', 'source', '1')).rejects.toThrow(
      'migration failed'
    );
    expect(deleteFavorite).not.toHaveBeenCalled();
    expect(getSkipConfig).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('DbManager tryCronLock', () => {
  it('runs the job and returns ran when the lock is acquired', async () => {
    const releaseLock = jest.fn().mockResolvedValue(true);
    const storage = {
      acquireLock: jest.fn().mockResolvedValue(true),
      renewLock: jest.fn().mockResolvedValue(true),
      releaseLock,
    } as unknown as IStorage;
    const manager = new DbManager(storage);
    const fn = jest.fn().mockResolvedValue(undefined);

    await expect(manager.tryCronLock(fn)).resolves.toBe('ran');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalled();
  });

  it('runs immediately when storage has no distributed lock', async () => {
    const manager = new DbManager({} as IStorage);
    const fn = jest.fn().mockResolvedValue(undefined);

    await expect(manager.tryCronLock(fn)).resolves.toBe('ran');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns busy without running the job when the lock is held', async () => {
    jest.useFakeTimers();
    try {
      const fn = jest.fn();
      const storage = {
        acquireLock: jest.fn().mockResolvedValue(false),
        renewLock: jest.fn().mockResolvedValue(true),
        releaseLock: jest.fn().mockResolvedValue(true),
      } as unknown as IStorage;
      const manager = new DbManager(storage);

      const resultPromise = manager.tryCronLock(fn);
      await jest.advanceTimersByTimeAsync(300);
      await expect(resultPromise).resolves.toBe('busy');
      expect(fn).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('rethrows unexpected lock errors', async () => {
    const storage = {
      acquireLock: jest.fn().mockRejectedValue(new Error('redis down')),
      renewLock: jest.fn(),
      releaseLock: jest.fn(),
    } as unknown as IStorage;
    const manager = new DbManager(storage);

    await expect(manager.tryCronLock(async () => undefined)).rejects.toThrow(
      'redis down'
    );
  });
});
