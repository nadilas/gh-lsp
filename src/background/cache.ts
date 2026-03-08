import type { CacheEntry } from '../shared/types';

/**
 * Generic LRU cache with per-entry TTL.
 *
 * Uses a Map for O(1) lookup. Map insertion order provides LRU semantics:
 * on access, entries are moved to the end (most recently used); on eviction,
 * the first entry (oldest) is removed.
 */
export class LruCache<T> {
  private entries: Map<string, CacheEntry<T>> = new Map();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;

  constructor(maxEntries: number, defaultTtlMs: number) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Retrieves a cached value by key.
   * Returns null if the key is missing or the entry has expired.
   * On hit, moves the entry to the end of the map (most recently used).
   */
  get(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }

    // Check TTL expiration
    if (Date.now() > entry.cachedAt + entry.ttlMs) {
      this.entries.delete(key);
      return null;
    }

    // Move to end for LRU ordering
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.value;
  }

  /**
   * Stores a value in the cache. If the cache exceeds maxEntries after
   * insertion, the least recently used (oldest) entry is evicted.
   */
  set(key: string, value: T, ttlMs?: number): void {
    // Remove existing entry to update insertion order
    this.entries.delete(key);

    const entry: CacheEntry<T> = {
      key,
      value,
      cachedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    };

    this.entries.set(key, entry);

    // Evict oldest entries if over capacity
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }
  }

  /**
   * Checks if a key exists and has not expired.
   */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }

    if (Date.now() > entry.cachedAt + entry.ttlMs) {
      this.entries.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Deletes all entries whose key starts with the given prefix.
   * Useful for invalidating all cached data for a particular repo/ref.
   */
  invalidateByPrefix(prefix: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Removes all entries from the cache.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Returns the number of entries currently in the cache (including expired
   * entries that have not yet been lazily evicted).
   */
  get size(): number {
    return this.entries.size;
  }
}
