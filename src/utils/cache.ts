import logger from './logger.js';

/**
 * In-memory cache with TTL support
 * Can be extended to use Redis for distributed caching
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class RedisCache {
  private cache = new Map<string, CacheEntry<any>>();

  /**
   * Get value from cache if not expired
   */
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    logger.debug(`Cache hit for key: ${key}`);
    return entry.value as T;
  }

  /**
   * Set value in cache with TTL
   */
  async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiresAt });
    logger.debug(`Cached ${key} for ${ttlSeconds}s`);
  }

  /**
   * Delete specific key
   */
  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    logger.debug(`Deleted cache key: ${key}`);
  }

  /**
   * Clear all cache
   */
  async clear(): Promise<void> {
    this.cache.clear();
    logger.info('Cleared all cache');
  }

  /**
   * Get cache stats
   */
  getStats(): {
    size: number;
    keys: string[];
  } {
    // Clean expired entries
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }

    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}
