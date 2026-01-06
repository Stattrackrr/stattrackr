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
    const request = this.makeRequest<T>(url, options).catch((error: any) => {
      // Handle rate limit errors gracefully - return null instead of throwing
      if (error?.message?.includes('429') || error?.message?.includes('Rate limit')) {
        console.warn(`[RequestCache] Rate limit exceeded for ${url}, returning null`);
        return null as T;
      }
      // Re-throw other errors
      throw error;
    });

    // Store as pending
    this.pending.set(cacheKey, request);

    try {
      const data = await request;

      // If data is null (rate limited), don't cache it
      if (data === null) {
        return null as T;
      }

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

  private async makeRequest<T>(url: string, options?: RequestInit, retries = 0): Promise<T> {
    const response = await fetch(url, options);

    if (!response.ok) {
      // Handle rate limit (429) with retry logic
      if (response.status === 429) {
        const errorText = await response.text().catch(() => response.statusText);
        
        // Parse reset time from error response if available
        let resetAt: number | null = null;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.resetAt) {
            resetAt = new Date(errorData.resetAt).getTime();
          }
        } catch {
          // If we can't parse, use default backoff
        }
        
        // Calculate wait time: use resetAt if available, otherwise exponential backoff
        const waitTime = resetAt 
          ? Math.max(0, resetAt - Date.now() + 1000) // Add 1 second buffer
          : Math.min(1000 * Math.pow(2, retries), 30000); // Max 30 seconds
        
        // Only retry if we haven't exceeded max retries and wait time is reasonable
        if (retries < 2 && waitTime < 60000) {
          console.warn(`[RequestCache] Rate limit hit for ${url}, retrying after ${Math.round(waitTime / 1000)}s...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          return this.makeRequest<T>(url, options, retries + 1);
        }
        
        // If we can't retry, return null instead of throwing (will be handled gracefully by calling code)
        console.warn(`[RequestCache] Rate limit exceeded for ${url} after ${retries} retries, returning null`);
        return null as T;
      }
      
      // Include URL in error message for debugging
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`HTTP ${response.status}: ${response.statusText} - URL: ${url} - ${errorText}`);
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
