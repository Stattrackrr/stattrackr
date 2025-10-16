/**
 * Server-side cache utility for API responses
 * Provides in-memory caching with TTL (time-to-live) expiration
 * Shared across all users to minimize API calls
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // time-to-live in milliseconds
}

class ServerCache {
  private cache = new Map<string, CacheEntry<any>>();
  
  /**
   * Get cached data if it exists and hasn't expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    const now = Date.now();
    const isExpired = (now - entry.timestamp) > entry.ttl;
    
    if (isExpired) {
      this.cache.delete(key);
      return null;
    }
    
    console.log(`🎯 Cache HIT for key: ${key}`);
    return entry.data;
  }
  
  /**
   * Store data in cache with TTL
   */
  set<T>(key: string, data: T, ttlMinutes: number): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttlMinutes * 60 * 1000 // convert minutes to milliseconds
    };
    
    this.cache.set(key, entry);
    console.log(`💾 Cache SET for key: ${key} (TTL: ${ttlMinutes}m)`);
  }
  
  /**
   * Remove specific cache entry
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      console.log(`🗑️ Cache DELETE for key: ${key}`);
    }
    return deleted;
  }
  
  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    console.log('🧹 Cache CLEARED');
  }
  
  /**
   * Get all cache keys (including expired ones)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }
  
  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    const validEntries = entries.filter(([_, entry]) => (now - entry.timestamp) <= entry.ttl);
    const expiredEntries = entries.length - validEntries.length;
    
    return {
      totalEntries: entries.length,
      validEntries: validEntries.length,
      expiredEntries,
      keys: validEntries.map(([key]) => key)
    };
  }
  
  /**
   * Clean up expired entries (should be called periodically)
   */
  cleanup(): number {
    const now = Date.now();
    let removedCount = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      const isExpired = (now - entry.timestamp) > entry.ttl;
      if (isExpired) {
        this.cache.delete(key);
        removedCount++;
      }
    }
    
    if (removedCount > 0) {
      console.log(`🧹 Cache cleanup removed ${removedCount} expired entries`);
    }
    
    return removedCount;
  }
}

// Global cache instance (singleton)
const cache = new ServerCache();

// Cache TTL configurations (in minutes)
export const CACHE_TTL = {
  PLAYER_STATS: 8 * 60,  // Player game stats - 8 hours (refreshed overnight at 3:30am/5:30am ET)
  PLAYER_SEARCH: 24 * 60, // Player search results - 24 hours (refreshed daily)
  GAMES: 60,             // Games schedule - 1 hour (no live scores needed)
  ESPN_PLAYER: 24 * 60,  // ESPN player data - 24 hours (refreshed daily)
  ADVANCED_STATS: 60,    // Advanced stats - 1 hour
  ODDS: 17,              // Odds data - 17 minutes (frequent but not too aggressive)
  DEPTH_CHART: 120,      // Depth chart - 2 hours (lineups don't change often)
  INJURIES: 30,          // Injury reports - 30 minutes
} as const;

// Cache key generators
export const getCacheKey = {
  playerStats: (playerId: string, season?: number) => 
    `player_stats_${playerId}_${season || 'current'}`,
  playerSearch: (query: string) => 
    `player_search_${query.toLowerCase().trim()}`,
  games: (startDate: string, endDate: string) => 
    `games_${startDate}_${endDate}`,
  espnPlayer: (playerName: string, team?: string) => 
    `espn_player_${playerName.toLowerCase()}_${team || 'any'}`,
  advancedStats: (playerId: string) => 
    `advanced_stats_${playerId}`,
  odds: (sport: string, player: string, market: string) => 
    `odds_${sport}_${player.toLowerCase()}_${market}`,
  depthChart: (team: string) => 
    `depth_chart_${team.toUpperCase()}`,
  injuries: (team: string) => 
    `injuries_${team.toUpperCase()}`,
};

export { cache };
export default cache;

// Auto-cleanup expired entries every 10 minutes
if (typeof global !== 'undefined') {
  setInterval(() => {
    cache.cleanup();
  }, 10 * 60 * 1000);
}