/**
 * Tiny in-process TTL cache with in-flight de-duplication.
 *
 * The de-duplication matters more than the caching here: without it, N browser
 * tabs loading the dashboard at once fire N requests at a metered price API.
 */
export class TtlCache {
  #entries = new Map();
  #inflight = new Map();

  /**
   * @param {string} key
   * @param {number} ttlSeconds
   * @param {() => Promise<unknown>} produce
   */
  async get(key, ttlSeconds, produce) {
    const hit = this.#entries.get(key);
    const now = Date.now();
    if (hit && hit.expiresAt > now) return { value: hit.value, cached: true, ageSeconds: Math.round((now - hit.storedAt) / 1000) };

    const pending = this.#inflight.get(key);
    if (pending) return { value: await pending, cached: false, ageSeconds: 0 };

    const promise = (async () => {
      const value = await produce();
      this.#entries.set(key, { value, storedAt: Date.now(), expiresAt: Date.now() + ttlSeconds * 1000 });
      return value;
    })();

    this.#inflight.set(key, promise);
    try {
      const value = await promise;
      return { value, cached: false, ageSeconds: 0 };
    } finally {
      this.#inflight.delete(key);
    }
  }

  /** Returns a stale entry if one exists, regardless of expiry. Used as a fallback when a refresh fails. */
  peekStale(key) {
    const hit = this.#entries.get(key);
    if (!hit) return null;
    return { value: hit.value, ageSeconds: Math.round((Date.now() - hit.storedAt) / 1000) };
  }

  clear() {
    this.#entries.clear();
    this.#inflight.clear();
  }
}
