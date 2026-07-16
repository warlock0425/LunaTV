import {
  deduplicatePlayRecordList,
  getPlayRecordKeysToReplace,
  hydratePlayRecord,
  PlayRecordLike,
} from './play-records';

describe('getPlayRecordKeysToReplace', () => {
  test('same source+id returns matching key', () => {
    const records: Record<string, PlayRecordLike> = {
      'sourceA+123': {
        title: '鬼灭之刃',
        source: 'sourceA',
        id: '123',
        key: 'sourceA+123',
      } as PlayRecordLike,
    };
    const target = {
      source: 'sourceA',
      id: '123',
      title: '鬼灭之刃',
    } as PlayRecordLike;
    expect(getPlayRecordKeysToReplace(records, target)).toEqual([
      'sourceA+123',
    ]);
  });

  test('different source same title (trad/simp) returns matching key', () => {
    const records: Record<string, PlayRecordLike> = {
      'sourceB+456': {
        title: '鬼滅之刃',
        source: 'sourceB',
        id: '456',
        key: 'sourceB+456',
      } as PlayRecordLike,
    };
    // Target uses simplified, record uses traditional - should match via normalization
    const target = {
      source: 'sourceA',
      id: '789',
      title: '鬼灭之刃',
    } as PlayRecordLike;
    const result = getPlayRecordKeysToReplace(records, target);
    expect(result).toContain('sourceB+456');
  });

  test('completely different title returns empty', () => {
    const records: Record<string, PlayRecordLike> = {
      'sourceA+123': {
        title: '海賊王',
        source: 'sourceA',
        id: '123',
        key: 'sourceA+123',
      } as PlayRecordLike,
    };
    const target = {
      source: 'sourceB',
      id: '456',
      title: '火影忍者',
    } as PlayRecordLike;
    expect(getPlayRecordKeysToReplace(records, target)).toEqual([]);
  });

  test('year mismatch prevents title-based matching', () => {
    const records: Record<string, PlayRecordLike> = {
      'sourceA+1': {
        title: '鬼灭之刃',
        source: 'sourceA',
        id: '1',
        year: '2019',
        key: 'sourceA+1',
      } as PlayRecordLike,
    };
    const target = {
      source: 'sourceB',
      id: '2',
      title: '鬼灭之刃',
      year: '2023',
    } as PlayRecordLike;
    expect(getPlayRecordKeysToReplace(records, target)).toEqual([]);
  });

  test('same source+id still matches despite year mismatch', () => {
    const records: Record<string, PlayRecordLike> = {
      'sourceA+1': {
        title: '鬼灭之刃',
        source: 'sourceA',
        id: '1',
        year: '2019',
        key: 'sourceA+1',
      } as PlayRecordLike,
    };
    const target = {
      source: 'sourceA',
      id: '1',
      title: '鬼灭之刃',
      year: '2023',
    } as PlayRecordLike;
    expect(getPlayRecordKeysToReplace(records, target)).toEqual(['sourceA+1']);
  });

  test('empty records returns empty', () => {
    expect(
      getPlayRecordKeysToReplace({}, { title: 'test' } as PlayRecordLike)
    ).toEqual([]);
  });
});

describe('deduplicatePlayRecordList', () => {
  test('keeps latest record when duplicates exist', () => {
    const records: PlayRecordLike[] = [
      {
        title: '進擊的巨人',
        source: 'A',
        id: '1',
        save_time: 100,
        key: 'A+1',
      } as PlayRecordLike,
      {
        title: '進擊的巨人',
        source: 'A',
        id: '1',
        save_time: 200,
        key: 'A+1',
      } as PlayRecordLike,
    ];
    const result = deduplicatePlayRecordList(records);
    expect(result).toHaveLength(1);
    expect(result[0].save_time).toBe(200);
  });

  test('keeps different shows separate', () => {
    const records: PlayRecordLike[] = [
      {
        title: '進擊的巨人',
        source: 'A',
        id: '1',
        save_time: 100,
        key: 'A+1',
      } as PlayRecordLike,
      {
        title: '鬼滅之刃',
        source: 'A',
        id: '2',
        save_time: 200,
        key: 'A+2',
      } as PlayRecordLike,
    ];
    const result = deduplicatePlayRecordList(records);
    expect(result).toHaveLength(2);
  });

  test('filters out records with no title', () => {
    const records: PlayRecordLike[] = [
      { source: 'A', id: '1', save_time: 100, key: 'A+1' } as PlayRecordLike,
    ];
    const result = deduplicatePlayRecordList(records);
    expect(result).toHaveLength(0);
  });

  test('orders results by save_time descending', () => {
    const records: PlayRecordLike[] = [
      {
        title: '作品A',
        source: 'A',
        id: '1',
        save_time: 100,
        key: 'A+1',
      } as PlayRecordLike,
      {
        title: '作品B',
        source: 'B',
        id: '2',
        save_time: 300,
        key: 'B+2',
      } as PlayRecordLike,
      {
        title: '作品C',
        source: 'C',
        id: '3',
        save_time: 200,
        key: 'C+3',
      } as PlayRecordLike,
    ];
    const result = deduplicatePlayRecordList(records);
    expect(result.map((r) => r.title)).toEqual(['作品B', '作品C', '作品A']);
  });
});

describe('hydratePlayRecord', () => {
  test('fills source and id from key', () => {
    const record = { title: '測試', key: 'mySource+myId' } as PlayRecordLike;
    const result = hydratePlayRecord(record);
    expect(result.source).toBe('mySource');
    expect(result.id).toBe('myId');
    expect(result.vod_id).toBe('myId');
    expect(result.vod_name).toBe('測試');
  });

  test('prefers explicit source/id over key', () => {
    const record = {
      title: '測試',
      source: 'explicit',
      id: 'explicitId',
      key: 'fromKey+keyId',
    } as PlayRecordLike;
    const result = hydratePlayRecord(record);
    expect(result.source).toBe('explicit');
    expect(result.id).toBe('explicitId');
  });

  test('uses vod_name as fallback for title', () => {
    const record = { vod_name: '備選名稱', key: 'src+id' } as PlayRecordLike;
    const result = hydratePlayRecord(record);
    expect(result.vod_name).toBe('備選名稱');
  });
});
