import { NextResponse } from 'next/server';

type CronAuthResult =
  | { authorized: true }
  | { authorized: false; response: NextResponse };

/**
 * Validate that a request is authorized to trigger cron endpoints.
 * Requires the CRON_SECRET environment variable and checks either:
 * - Authorization: Bearer <secret>
 * - X-Cron-Secret: <secret>
 * - X-Vercel-Cron: 1 (automatic Vercel cron calls)
 */
export function authorizeCronRequest(request: Request): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;

  // Check if this is a Vercel Cron call (they send x-vercel-cron header)
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  
  // Vercel Cron calls are automatically authenticated by Vercel
  if (isVercelCron) {
    return { authorized: true };
  }

  if (!cronSecret) {
    throw new Error('CRON_SECRET environment variable is required for cron endpoints');
  }

  const headerSecret = request.headers.get('x-cron-secret');
  const authHeader = request.headers.get('authorization');

  const bearerSecret = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  // Also check query parameter for easier manual testing
  let querySecret = null;
  try {
    const url = new URL(request.url);
    querySecret = url.searchParams.get('secret');
  } catch (e) {
    // Ignore URL parsing errors
  }

  const providedSecret = querySecret || headerSecret || bearerSecret;

  if (!providedSecret || providedSecret !== cronSecret) {
    return {
      authorized: false,
      response: NextResponse.json(
        {
          error: 'Unauthorized cron access',
        },
        { status: 401 }
      ),
    };
  }

  return { authorized: true };
}




