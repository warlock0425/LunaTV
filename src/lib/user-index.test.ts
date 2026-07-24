import { reconcileUserIndex } from './user-index';

describe('reconcileUserIndex', () => {
  // 這是本模組存在的理由：索引漏登記的帳號（如經備份匯入還原的管理員）
  // 能登入卻永遠不被 cron 集數更新掃到
  it('把只有密碼鍵、不在索引裡的帳號補回名冊', () => {
    const result = reconcileUserIndex(
      ['alice'],
      ['u:alice:pwd', 'u:zaq294800:pwd']
    );
    expect(result.users.sort()).toEqual(['alice', 'zaq294800']);
    expect(result.missing).toEqual(['zaq294800']);
  });

  it('索引完整時名冊不變、無需補登記', () => {
    const result = reconcileUserIndex(
      ['alice', 'bob'],
      ['u:alice:pwd', 'u:bob:pwd']
    );
    expect(result.users.sort()).toEqual(['alice', 'bob']);
    expect(result.missing).toEqual([]);
  });

  it('索引 Set 完全不存在（空）時仍能從密碼鍵重建名冊', () => {
    const result = reconcileUserIndex([], ['u:alice:pwd', 'u:bob:pwd']);
    expect(result.users.sort()).toEqual(['alice', 'bob']);
    expect(result.missing.sort()).toEqual(['alice', 'bob']);
  });

  it('保留只在索引裡的成員（不因缺密碼鍵而剔除）', () => {
    const result = reconcileUserIndex(['legacy'], []);
    expect(result.users).toEqual(['legacy']);
    expect(result.missing).toEqual([]);
  });

  it('略過不符合格式的鍵', () => {
    const result = reconcileUserIndex(
      [],
      ['u:pwd', 'u::pwd', 'other:key', 'u:ok:pwd']
    );
    expect(result.users).toEqual(['ok']);
  });

  it('使用者名稱含冒號仍可解析（與既有遷移正則一致）', () => {
    const result = reconcileUserIndex([], ['u:a:b:pwd']);
    expect(result.users).toEqual(['a:b']);
  });

  it('重複鍵去重', () => {
    const result = reconcileUserIndex(
      ['alice'],
      ['u:alice:pwd', 'u:alice:pwd', 'u:bob:pwd', 'u:bob:pwd']
    );
    expect(result.users.sort()).toEqual(['alice', 'bob']);
    expect(result.missing).toEqual(['bob']);
  });
});
