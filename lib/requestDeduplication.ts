// Request deduplication utility
// Prevents multiple identical requests from firing simultaneously
// Dramatically improves performance and reduces API quota usage

interface PendingRequest<T> {
  promise: Promise<T>;
  timestamp: number;
}

class RequestDeduplicator {
  private pending = new Map<string, PendingRequest<unknown>>();
  private readonly maxAge: number; // Max age in milliseconds

  constructor(maxAgeSeconds: number = 30) {
    this.maxAge = maxAgeSeconds * 1000;
    
    // Clean up stale entries every minute
    setInterval(() => this.cleanup(), 60 * 1000);
  }

  /**
   * Execute a request with deduplication
   * If an identical request is already in flight, return that promise instead
   * 
   * @param key - Unique identifier for the request
   * @param fn - Function that returns a promise (the actual request)
   * @returns Promise with the result
   */
  async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Check if we have a pending request for this key
    const existing = this.pending.get(key) as PendingRequest<T> | undefined;
    
    if (existing) {
      const age = Date.now() - existing.timestamp;
      
      // If the request is still fresh, reuse it
      if (age < this.maxAge) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`🔄 Deduplicating request: ${key}`);
        }
        return existing.promise;
      } else {
        // Request is too old, remove it
        this.pending.delete(key);
      }
    }

    // Create new request
    if (process.env.NODE_ENV === 'development') {
      console.log(`🆕 New request: ${key}`);
    }
    const promise = fn()
      .finally(() => {
        // Clean up after request completes
        this.pending.delete(key);
      });

    // Store the pending request
    this.pending.set(key, {
      promise,
      timestamp: Date.now()
    });

    return promise;
  }

  /**
   * Clear a specific pending request
   */
  clear(key: string): void {
    this.pending.delete(key);
  }

  /**
   * Clear all pending requests
   */
  clearAll(): void {
    this.pending.clear();
  }

  /**
   * Clean up stale entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.pending.entries()) {
      const age = now - entry.timestamp;
      if (age > this.maxAge) {
        this.pending.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0 && process.env.NODE_ENV === 'development') {
      console.log(`🧹 Request deduplicator cleaned ${cleaned} stale entries`);
    }
  }

  /**
   * Get stats about current deduplication state
   */
  getStats() {
    return {
      pendingRequests: this.pending.size,
      keys: Array.from(this.pending.keys())
    };
  }
}

// Global deduplicator instance
export const requestDeduplicator = new RequestDeduplicator(30);

/**
 * Generate a cache key for player stats requests
 */
export function getPlayerStatsKey(playerId: string, season: number, postseason: boolean = false): string {
  return `player-stats:${playerId}:${season}:${postseason ? 'playoffs' : 'regular'}`;
}

/**
 * Generate a cache key for game requests
 */
export function getGamesKey(startDate: string, endDate: string, teamId?: number): string {
  return `games:${startDate}:${endDate}${teamId ? `:team-${teamId}` : ''}`;
}

/**
 * Generate a cache key for advanced stats requests
 */
export function getAdvancedStatsKey(playerIds: number[], season?: string, postseason: boolean = false): string {
  const sortedIds = [...playerIds].sort((a, b) => a - b).join(',');
  return `advanced-stats:${sortedIds}:${season || 'current'}:${postseason ? 'playoffs' : 'regular'}`;
}

/**
 * Generate a cache key for DVP requests
 */
export function getDvpKey(team: string, metric: string, games: number, season: number): string {
  return `dvp:${team}:${metric}:${games}:${season}`;
}
