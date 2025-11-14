/**
 * Background scheduler for odds data refresh
 * Runs every 20 minutes to keep odds data fresh with minimal API calls
 */

import { CACHE_TTL } from './cache';

const REFRESH_INTERVAL = CACHE_TTL.ODDS * 60 * 1000; // 17 minutes in milliseconds
let refreshInterval: NodeJS.Timeout | null = null;

/**
 * Fetch odds data by calling the refresh function directly
 */
async function refreshOdds() {
  try {
    // Only log in production to avoid console noise in development
    if (process.env.VERCEL_ENV === 'production') {
      console.log('🔄 Triggering scheduled odds refresh...');
    }
    
    // Import and call the refresh function directly to share cache instance
    const { refreshOddsData } = await import('./refreshOdds');
    const result = await refreshOddsData({ source: 'scheduler' });
    
    if (process.env.VERCEL_ENV === 'production') {
      console.log(`✅ Scheduled odds refresh complete: ${result.gamesCount} games, ${result.apiCalls} API calls`);
    }
  } catch (error) {
    // Always log errors
    console.error('❌ Scheduled odds refresh error:', error);
  }
}

/**
 * Start the background odds refresh scheduler
 */
export function startOddsScheduler() {
  if (refreshInterval) {
    if (process.env.VERCEL_ENV === 'production') {
      console.log('⚠️ Odds scheduler already running');
    }
    return;
  }
  
  if (process.env.VERCEL_ENV === 'production') {
    console.log(`🚀 Starting odds scheduler (refresh every ${CACHE_TTL.ODDS} minutes)`);
  }
  
  // Initial refresh on startup
  setTimeout(() => {
    refreshOdds();
  }, 5000); // Wait 5 seconds after startup
  
  // Schedule recurring refreshes
  refreshInterval = setInterval(() => {
    refreshOdds();
  }, REFRESH_INTERVAL);
}

/**
 * Stop the background odds refresh scheduler
 */
export function stopOddsScheduler() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('🛑 Odds scheduler stopped');
  }
}

// Auto-start in server environment (not in browser or during build)
if (typeof window === 'undefined' && process.env.NODE_ENV !== 'test') {
  // Only start in production deployment, not during dev or build
  if (process.env.VERCEL_ENV === 'production') {
    startOddsScheduler();
  }
}
