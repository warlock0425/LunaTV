import {
  makeSkipIdentityKey,
  makeSkipIdentityParts,
  SKIP_IDENTITY_SOURCE,
} from './skip-identity';
import { generateStorageKey } from './storage-key';

describe('skip identity', () => {
  it('prefers douban id over title', () => {
    expect(
      makeSkipIdentityParts({
        doubanId: 1296698,
        title: '海賊王',
        year: '1999',
      })
    ).toEqual({ source: SKIP_IDENTITY_SOURCE, id: 'd1296698' });
  });

  it('same title and year share a key across sources', () => {
    const a = makeSkipIdentityKey({ title: '海賊王', year: '1999' });
    const b = makeSkipIdentityKey({ title: '海 賊 王', year: 1999 });
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(a?.startsWith(`${SKIP_IDENTITY_SOURCE}+t`)).toBe(true);
  });

  it('different titles do not share a key', () => {
    expect(makeSkipIdentityKey({ title: '海賊王', year: '1999' })).not.toBe(
      makeSkipIdentityKey({ title: '火影忍者', year: '1999' })
    );
  });

  it('produces storage keys the skip API will accept', () => {
    const key = makeSkipIdentityKey({ doubanId: 1296698 });
    expect(key).toBe(generateStorageKey(SKIP_IDENTITY_SOURCE, 'd1296698'));
  });
});
