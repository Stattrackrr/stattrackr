/**
 * Next.js instrumentation file
 * Runs once on server startup to initialize background jobs
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on server side and in production
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.VERCEL_ENV === 'production') {
    try {
      // Import and start the odds scheduler
      const { startOddsScheduler } = await import('./lib/oddsScheduler');
      startOddsScheduler();
    } catch (error) {
      console.error('❌ Failed to start odds scheduler:', error);
      // Don't throw - let the app continue without the scheduler
    }
    
    try {
      // Import and start the tracking stats scheduler
      const { startTrackingStatsScheduler } = await import('./lib/trackingStatsScheduler');
      startTrackingStatsScheduler();
    } catch (error) {
      console.error('❌ Failed to start tracking stats scheduler:', error);
      // Don't throw - let the app continue without the scheduler
    }
  }
}
