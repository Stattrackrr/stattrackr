/**
 * Global request deduplication and caching utility
 * Prevents duplicate API calls when multiple components request the same data simultaneously
 */

type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

type PendingRequest<T> = Promise<T>;

class RequestCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private pending: Map<string, PendingRequest<any>> = new Map();
  private defaultTTL: number = 60000; // 1 minute default TTL

  /**
   * Fetch data with automatic deduplication and caching
   * If multiple components request the same URL simultaneously, only one request is made
   */
  async fetch<T = any>(
    url: string,
    options?: RequestInit,
    ttl: number = this.defaultTTL
  ): Promise<T> {
    const cacheKey = this.getCacheKey(url, options);

    // Check if we have a valid cached response
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttl) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Cache HIT] ${url}`);
      }
      return cached.data;
    }

    // Check if there's already a pending request for this URL
    const pending = this.pending.get(cacheKey);
    if (pending) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[Deduplicating] ${url}`);
      }
      return pending;
    }

    // Create new request
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Cache MISS] ${url}`);
    }
    const request = this.makeRequest<T>(url, options);

    // Store as pending
    this.pending.set(cacheKey, request);

    try {
      const data = await request;

      // Cache the result
      this.cache.set(cacheKey, {
        data,
        timestamp: Date.now(),
      });

      return data;
    } finally {
      // Remove from pending
      this.pending.delete(cacheKey);
    }
  }

  /**
   * Batch fetch multiple URLs and return results in order
   */
  async fetchBatch<T = any>(
    urls: string[],
    options?: RequestInit,
    ttl: number = this.defaultTTL
  ): Promise<T[]> {
    return Promise.all(urls.map((url) => this.fetch<T>(url, options, ttl)));
  }

  /**
   * Invalidate cache for a specific URL or pattern
   */
  invalidate(urlPattern: string | RegExp): void {
    const pattern = typeof urlPattern === 'string' 
      ? new RegExp(urlPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      : urlPattern;

    for (const [key] of this.cache) {
      if (pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache and pending requests
   */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      pendingRequests: this.pending.size,
    };
  }

  private getCacheKey(url: string, options?: RequestInit): string {
    const method = options?.method || 'GET';
    const body = options?.body ? JSON.stringify(options.body) : '';
    return `${method}:${url}:${body}`;
  }

  private async makeRequest<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }
}

// Global singleton instance
export const requestCache = new RequestCache();

// Convenience wrapper for fetch with deduplication
export const cachedFetch = <T = any>(
  url: string,
  options?: RequestInit,
  ttl?: number
): Promise<T> => {
  return requestCache.fetch<T>(url, options, ttl);
};
