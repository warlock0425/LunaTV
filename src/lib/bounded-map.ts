export function setBoundedMapValue<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number
): void {
  if (maxEntries < 1) return;

  // Reinsert existing keys so insertion order also acts as a simple LRU order.
  map.delete(key);
  map.set(key, value);

  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value as K | undefined;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}

export function pruneExpiredMapValues<K, V>(
  map: Map<K, V>,
  getExpiresAt: (value: V) => number,
  now = Date.now()
): void {
  for (const [key, value] of Array.from(map.entries())) {
    if (getExpiresAt(value) <= now) {
      map.delete(key);
    }
  }
}
