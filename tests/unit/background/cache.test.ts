import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LruCache } from '../../../src/background/cache';

describe('LruCache', () => {
  let cache: LruCache<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new LruCache<string>(3, 60_000); // max 3 entries, 60s default TTL
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('get', () => {
    it('returns null for missing keys', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('returns cached value on hit', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('returns null and removes entry after TTL expires', () => {
      cache.set('key1', 'value1');

      // Advance past default TTL
      vi.advanceTimersByTime(60_001);

      expect(cache.get('key1')).toBeNull();
      expect(cache.size).toBe(0);
    });

    it('returns value when TTL has not expired', () => {
      cache.set('key1', 'value1');

      vi.advanceTimersByTime(59_999);

      expect(cache.get('key1')).toBe('value1');
    });

    it('moves accessed entry to most recently used position', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      // Access 'a' to make it most recently used
      cache.get('a');

      // Adding a new entry should evict 'b' (now oldest), not 'a'
      cache.set('d', '4');

      expect(cache.get('a')).toBe('1');
      expect(cache.get('b')).toBeNull(); // evicted
      expect(cache.get('c')).toBe('3');
      expect(cache.get('d')).toBe('4');
    });
  });

  describe('set', () => {
    it('stores entries', () => {
      cache.set('key1', 'value1');
      expect(cache.size).toBe(1);
      expect(cache.get('key1')).toBe('value1');
    });

    it('overwrites existing entries', () => {
      cache.set('key1', 'old');
      cache.set('key1', 'new');
      expect(cache.get('key1')).toBe('new');
      expect(cache.size).toBe(1);
    });

    it('evicts oldest entry when exceeding max capacity', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');
      cache.set('d', '4'); // should evict 'a'

      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toBe('2');
      expect(cache.get('c')).toBe('3');
      expect(cache.get('d')).toBe('4');
    });

    it('accepts custom TTL per entry', () => {
      cache.set('short', 'value', 1_000); // 1s TTL
      cache.set('long', 'value', 120_000); // 120s TTL

      vi.advanceTimersByTime(1_001);

      expect(cache.get('short')).toBeNull();
      expect(cache.get('long')).toBe('value');
    });

    it('evicts multiple entries if needed', () => {
      const smallCache = new LruCache<string>(2, 60_000);
      smallCache.set('a', '1');
      smallCache.set('b', '2');
      // Both at capacity. Now set overwrites 'a', staying at 2
      smallCache.set('a', '1-updated');
      expect(smallCache.size).toBe(2);
      // Add a third entry, evicting the oldest (b)
      smallCache.set('c', '3');
      expect(smallCache.size).toBe(2);
      expect(smallCache.get('b')).toBeNull();
    });
  });

  describe('has', () => {
    it('returns false for missing keys', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('returns true for existing non-expired keys', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
    });

    it('returns false and cleans up expired keys', () => {
      cache.set('key1', 'value1');
      vi.advanceTimersByTime(60_001);
      expect(cache.has('key1')).toBe(false);
      expect(cache.size).toBe(0);
    });
  });

  describe('invalidateByPrefix', () => {
    it('removes all entries matching the prefix', () => {
      cache.set('owner/repo/main/file1.ts', 'content1');
      cache.set('owner/repo/main/file2.ts', 'content2');
      cache.set('owner/repo/dev/file3.ts', 'content3');

      cache.invalidateByPrefix('owner/repo/main/');

      expect(cache.size).toBe(1);
      expect(cache.get('owner/repo/main/file1.ts')).toBeNull();
      expect(cache.get('owner/repo/main/file2.ts')).toBeNull();
      expect(cache.get('owner/repo/dev/file3.ts')).toBe('content3');
    });

    it('does nothing when no entries match', () => {
      cache.set('a', '1');
      cache.set('b', '2');

      cache.invalidateByPrefix('xyz');

      expect(cache.size).toBe(2);
    });

    it('removes all entries when prefix is empty string', () => {
      cache.set('a', '1');
      cache.set('b', '2');

      cache.invalidateByPrefix('');

      expect(cache.size).toBe(0);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toBeNull();
      expect(cache.get('c')).toBeNull();
    });
  });

  describe('size', () => {
    it('returns 0 for empty cache', () => {
      expect(cache.size).toBe(0);
    });

    it('reflects current entry count', () => {
      cache.set('a', '1');
      expect(cache.size).toBe(1);
      cache.set('b', '2');
      expect(cache.size).toBe(2);
    });
  });

  describe('LRU eviction order', () => {
    it('evicts in insertion order when no accesses occur', () => {
      cache.set('first', '1');
      cache.set('second', '2');
      cache.set('third', '3');
      cache.set('fourth', '4'); // evicts 'first'

      expect(cache.get('first')).toBeNull();
      expect(cache.get('second')).toBe('2');
    });

    it('updates eviction order on set (overwrite)', () => {
      cache.set('a', '1');
      cache.set('b', '2');
      cache.set('c', '3');

      // Overwrite 'a' makes it most recent
      cache.set('a', '1-updated');

      // Adding 'd' should evict 'b' (now oldest)
      cache.set('d', '4');

      expect(cache.get('b')).toBeNull();
      expect(cache.get('a')).toBe('1-updated');
      expect(cache.get('c')).toBe('3');
      expect(cache.get('d')).toBe('4');
    });
  });

  describe('with complex value types', () => {
    it('works with object values', () => {
      const objCache = new LruCache<{ data: number }>(10, 60_000);
      const obj = { data: 42 };
      objCache.set('key', obj);
      expect(objCache.get('key')).toEqual({ data: 42 });
    });

    it('works with null values (stored, not confused with cache miss)', () => {
      const nullableCache = new LruCache<string | null>(10, 60_000);
      nullableCache.set('key', null);
      // null value is stored, but get returns null for both miss and null-value.
      // has() distinguishes the two.
      expect(nullableCache.has('key')).toBe(true);
    });
  });
});
