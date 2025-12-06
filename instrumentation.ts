/**
 * Next.js instrumentation file
 * Runs once on server startup to initialize background jobs
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Skip schedulers in serverless environments (Vercel)
  // Serverless functions are stateless and don't support long-running intervals
  // Use Vercel Cron Jobs instead (configured in vercel.json)
  if (process.env.VERCEL) {
    console.log('⏭️ Skipping schedulers in serverless environment - using Vercel Cron Jobs instead');
    return;
  }
  
  // Only run on server side and in production (non-serverless environments)
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
