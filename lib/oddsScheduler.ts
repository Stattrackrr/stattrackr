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
    console.log('🔄 Triggering scheduled odds refresh...');
    
    // Import and call the refresh function directly to share cache instance
    const { refreshOddsData } = await import('./refreshOdds');
    const result = await refreshOddsData();
    
    console.log(`✅ Scheduled odds refresh complete: ${result.gamesCount} games, ${result.apiCalls} API calls`);
  } catch (error) {
    console.error('❌ Scheduled odds refresh error:', error);
  }
}

/**
 * Start the background odds refresh scheduler
 */
export function startOddsScheduler() {
  if (refreshInterval) {
    console.log('⚠️ Odds scheduler already running');
    return;
  }
  
  console.log(`🚀 Starting odds scheduler (refresh every ${CACHE_TTL.ODDS} minutes)`);
  
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
  // Only start if we're in a runtime environment, not during build
  if (process.env.VERCEL_ENV || process.env.NODE_ENV === 'development') {
    startOddsScheduler();
  }
}
