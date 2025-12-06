/**
 * Next.js instrumentation file
 * Runs once on server startup to initialize background jobs
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * 
 * DISABLED on Vercel - serverless functions don't support long-running processes
 * Use Vercel Cron Jobs instead (configured in vercel.json)
 */

export async function register() {
  // Completely skip instrumentation on Vercel
  // Vercel serverless functions are stateless and don't support setInterval
  // All scheduled tasks are handled by Vercel Cron Jobs (see vercel.json)
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    // Silently skip - no need to log in production
    return;
  }
  
  // Only run in non-serverless production environments
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production') {
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
