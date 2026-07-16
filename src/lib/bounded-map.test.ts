import { pruneExpiredMapValues, setBoundedMapValue } from './bounded-map';

describe('bounded map helpers', () => {
  it('removes the oldest entry after reaching the limit', () => {
    const map = new Map<string, number>();
    setBoundedMapValue(map, 'a', 1, 2);
    setBoundedMapValue(map, 'b', 2, 2);
    setBoundedMapValue(map, 'c', 3, 2);

    expect(Array.from(map.entries())).toEqual([
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('refreshes insertion order when replacing an entry', () => {
    const map = new Map<string, number>();
    setBoundedMapValue(map, 'a', 1, 2);
    setBoundedMapValue(map, 'b', 2, 2);
    setBoundedMapValue(map, 'a', 3, 2);
    setBoundedMapValue(map, 'c', 4, 2);

    expect(Array.from(map.entries())).toEqual([
      ['a', 3],
      ['c', 4],
    ]);
  });

  it('prunes expired values', () => {
    const map = new Map([
      ['expired', { expiresAt: 10 }],
      ['fresh', { expiresAt: 30 }],
    ]);

    pruneExpiredMapValues(map, (value) => value.expiresAt, 20);

    expect(Array.from(map.keys())).toEqual(['fresh']);
  });
});
