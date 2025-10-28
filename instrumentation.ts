/**
 * Next.js instrumentation file
 * Runs once on server startup to initialize background jobs
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Import and start the odds scheduler
    const { startOddsScheduler } = await import('./lib/oddsScheduler');
    startOddsScheduler();
  }
}
