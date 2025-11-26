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
  private readonly maxSize: number = 1000; // Maximum cache entries
  private accessOrder = new Map<string, number>(); // Track access time for LRU
  
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
      this.accessOrder.delete(key);
      return null;
    }
    
    // Update access time for LRU
    this.accessOrder.set(key, now);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`🎯 Cache HIT for key: ${key}`);
    }
    return entry.data;
  }
  
  /**
   * Store data in cache with TTL
   * Implements LRU eviction when cache is full
   */
  set<T>(key: string, data: T, ttlMinutes: number): void {
    // Check if we need to evict entries
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    
    const now = Date.now();
    const entry: CacheEntry<T> = {
      data,
      timestamp: now,
      ttl: ttlMinutes * 60 * 1000 // convert minutes to milliseconds
    };
    
    this.cache.set(key, entry);
    this.accessOrder.set(key, now);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`💾 Cache SET for key: ${key} (TTL: ${ttlMinutes}m, size: ${this.cache.size}/${this.maxSize})`);
    }
  }
  
  /**
   * Remove specific cache entry
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    this.accessOrder.delete(key);
    if (deleted && process.env.NODE_ENV === 'development') {
      console.log(`🗑️ Cache DELETE for key: ${key}`);
    }
    return deleted;
  }
  
  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder.clear();
    if (process.env.NODE_ENV === 'development') {
      console.log('🧹 Cache CLEARED');
    }
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
        this.accessOrder.delete(key);
        removedCount++;
      }
    }
    
    if (removedCount > 0 && process.env.NODE_ENV === 'development') {
      console.log(`🧹 Cache cleanup removed ${removedCount} expired entries`);
    }
    
    return removedCount;
  }
  
  /**
   * Evict least recently used entry when cache is full
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    // Find the least recently accessed entry
    for (const [key, accessTime] of this.accessOrder.entries()) {
      if (accessTime < oldestTime) {
        oldestTime = accessTime;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.accessOrder.delete(oldestKey);
      if (process.env.NODE_ENV === 'development') {
        console.log(`♻️ Cache LRU evicted: ${oldestKey}`);
      }
    }
  }
}

// Global cache instance (singleton)
// Use globalThis to persist across hot reloads in development
const globalForCache = globalThis as unknown as {
  cache: ServerCache | undefined
}

const cache = globalForCache.cache ?? new ServerCache();

if (process.env.NODE_ENV !== 'production') {
  globalForCache.cache = cache;
}

// Cache TTL configurations (in minutes)
// These values balance freshness with API quota conservation
export const CACHE_TTL = {
  // Player game stats - 8 hours
  // Rationale: Game stats are finalized after games end. 8-hour cache ensures
  // overnight data is fresh while avoiding excessive API calls during the day
  PLAYER_STATS: 8 * 60,
  
  // Player search results - 24 hours
  // Rationale: Player roster data changes infrequently (trades, signings)
  PLAYER_SEARCH: 24 * 60,
  
  // Games schedule - 5 hours
  // Rationale: Game schedules need moderate freshness for accurate matchup data
  // 5 hours ensures data updates multiple times per day
  GAMES: 5 * 60,
  
  // ESPN player data - 24 hours
  // Rationale: Player profiles (height, weight, college) rarely change
  ESPN_PLAYER: 24 * 60,
  
  // Advanced stats - 1 hour
  // Rationale: Advanced metrics are computationally expensive but need regular updates
  ADVANCED_STATS: 60,
  
  // Odds data - 60 minutes
  // Rationale: Balance between freshness and external API quota usage
  ODDS: 60,
  
  // Depth chart - 2 hours
  // Rationale: Starting lineups and rotations change daily but not hourly
  DEPTH_CHART: 120,
  
  // Injury reports - 30 minutes
  // Rationale: Injury status can change quickly on game days
  INJURIES: 30,
  
  // Tracking stats (potentials) - Never expire (persist until new data found)
  // Rationale: Tracking stats are cumulative season data that updates once daily.
  // Cache persists until daily refresh finds new data, then replaces old cache.
  // Using 365 days as "never expire" (effectively permanent until replaced)
  TRACKING_STATS: 365 * 24 * 60, // 365 days = effectively never expire
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
  trackingStats: (team: string, season: number, category: string) => 
    `tracking_stats_${team.toUpperCase()}_${season}_${category}`,
  allTrackingStats: (season: number) =>
    `all_tracking_stats_${season}`,
};

export { cache };
export default cache;

// Auto-cleanup expired entries every 10 minutes
if (typeof global !== 'undefined') {
  setInterval(() => {
    cache.cleanup();
  }, 10 * 60 * 1000);
}