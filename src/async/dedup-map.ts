/**
 * DedupMap — Map with deduplication for concurrent async creation.
 *
 * When multiple callers request the same key concurrently, only one
 * factory call runs — all callers share the same inflight promise.
 *
 * Usage:
 *   const map = new DedupMap<string, Connection>();
 *   const conn = await map.getOrCreate('redis', () => connect('redis://...'));
 */

export class DedupMap<K, V> {
  private _values = new Map<K, V>();
  private _inflight = new Map<K, Promise<V>>();

  /** Number of resolved entries. */
  get size(): number {
    return this._values.size;
  }

  /** Check if a resolved value exists for key. */
  has(key: K): boolean {
    return this._values.has(key);
  }

  /** Get a resolved value (undefined if not yet created). */
  get(key: K): V | undefined {
    return this._values.get(key);
  }

  /** Set a value directly (bypasses factory). */
  set(key: K, value: V): void {
    this._inflight.delete(key);
    this._values.set(key, value);
  }

  /**
   * Get existing value or create one. Concurrent calls for the same
   * key join the same inflight promise instead of spawning duplicates.
   */
  async getOrCreate(key: K, factory: () => Promise<V>): Promise<V> {
    const existing = this._values.get(key);
    if (existing !== undefined) return existing;

    const inflight = this._inflight.get(key);
    if (inflight) return inflight;

    const promise = factory().then(
      (value) => {
        this._inflight.delete(key);
        this._values.set(key, value);
        return value;
      },
      (error) => {
        this._inflight.delete(key);
        throw error;
      }
    );

    this._inflight.set(key, promise);
    return promise;
  }

  /** Delete a key (cancels inflight if pending). */
  delete(key: K): boolean {
    this._inflight.delete(key);
    return this._values.delete(key);
  }

  /** Clear all entries and inflight promises. */
  clear(): void {
    this._inflight.clear();
    this._values.clear();
  }

  /** Iterate over resolved entries. Returns a snapshot (safe across await). */
  entries(): [K, V][] {
    return [...this._values.entries()];
  }

  /** Iterate over resolved keys. Returns a snapshot. */
  keys(): K[] {
    return [...this._values.keys()];
  }

  /** Iterate over resolved values. Returns a snapshot. */
  values(): V[] {
    return [...this._values.values()];
  }

  /** Iterate resolved entries via for...of. Returns snapshot array. */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return [...this._values.entries()][Symbol.iterator]();
  }
}
