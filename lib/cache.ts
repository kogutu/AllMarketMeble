const TTL_1_DAY = 24 * 60 * 60 * 1000;

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

export function cacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs = TTL_1_DAY): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Invalidate all keys that start with the given prefix (or all if omitted). */
export function cacheInvalidate(prefix?: string): void {
  if (!prefix) { store.clear(); return; }
  const toDelete: string[] = [];
  store.forEach((_, key) => { if (key.startsWith(prefix)) toDelete.push(key); });
  toDelete.forEach((k) => store.delete(k));
}

export function cacheStats(): { size: number; keys: string[] } {
  const now = Date.now();
  const live: string[] = [];
  store.forEach((entry, key) => { if (entry.expiresAt > now) live.push(key); });
  return { size: live.length, keys: live };
}
