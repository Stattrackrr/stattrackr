// lib/trackingStatsScheduler.ts
/**
 * Background scheduler for refreshing tracking stats cache
 * Runs once on server startup and periodically thereafter
 */

let schedulerInterval: NodeJS.Timeout | null = null;
let isRefreshing = false;
let lastRefreshTime: Date | null = null;
let nextRefreshTime: Date | null = null;

// Refresh interval: Once every 24 hours (tracking stats update daily)
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function refreshTrackingStats() {
  if (isRefreshing) {
    console.log('[Tracking Stats Scheduler] ⏭️ Skipping refresh - already in progress');
    return;
  }

  isRefreshing = true;
  console.log('[Tracking Stats Scheduler] 🔄 Starting refresh...');

  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const response = await fetch(`${baseUrl}/api/tracking-stats/refresh?season=2025`, {
      method: 'GET',
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`Refresh failed with status ${response.status}`);
    }

    const result = await response.json();
    lastRefreshTime = new Date();
    nextRefreshTime = new Date(Date.now() + REFRESH_INTERVAL_MS);

    console.log('[Tracking Stats Scheduler] ✅ Refresh complete:', {
      teamsProcessed: result.teamsProcessed,
      categoriesProcessed: result.categoriesProcessed,
      apiCalls: result.apiCalls,
      elapsed: result.elapsed,
      nextRefresh: nextRefreshTime.toISOString()
    });
  } catch (error: any) {
    console.error('[Tracking Stats Scheduler] ❌ Refresh failed:', error.message);
    // Schedule retry in 1 hour on failure
    nextRefreshTime = new Date(Date.now() + 60 * 60 * 1000);
  } finally {
    isRefreshing = false;
  }
}

export function startTrackingStatsScheduler() {
  if (schedulerInterval) {
    console.log('[Tracking Stats Scheduler] Already running');
    return;
  }

  console.log('[Tracking Stats Scheduler] 🚀 Starting scheduler (24-hour interval)');

  // Initial refresh on startup (after a short delay)
  setTimeout(() => {
    refreshTrackingStats();
  }, 5000); // 5 second delay to let server fully initialize

  // Set up recurring refresh
  schedulerInterval = setInterval(() => {
    refreshTrackingStats();
  }, REFRESH_INTERVAL_MS);

  console.log('[Tracking Stats Scheduler] ⏰ Next refresh in 24 hours');
}

export function stopTrackingStatsScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Tracking Stats Scheduler] 🛑 Stopped');
  }
}

export function getTrackingStatsSchedulerStatus() {
  return {
    isRunning: schedulerInterval !== null,
    isRefreshing,
    lastRefreshTime: lastRefreshTime?.toISOString() || null,
    nextRefreshTime: nextRefreshTime?.toISOString() || null,
    refreshIntervalMs: REFRESH_INTERVAL_MS
  };
}


