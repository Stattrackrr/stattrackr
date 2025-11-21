/**
 * Next.js instrumentation file
 * Runs once on server startup to initialize background jobs
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on server side and in production
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.VERCEL_ENV === 'production') {
    // Import and start the odds scheduler
    const { startOddsScheduler } = await import('./lib/oddsScheduler');
    startOddsScheduler();
    
    // Import and start the tracking stats scheduler
    const { startTrackingStatsScheduler } = await import('./lib/trackingStatsScheduler');
    startTrackingStatsScheduler();
  }
}
