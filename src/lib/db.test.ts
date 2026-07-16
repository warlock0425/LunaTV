import { DbManager } from './db';
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
    expect(records.user['old-source+1']).toBeUndefined();
  });
});
