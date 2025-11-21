import { NextResponse } from 'next/server';

type CronAuthResult =
  | { authorized: true }
  | { authorized: false; response: NextResponse };

/**
 * Validate that a request is authorized to trigger cron endpoints.
 * Requires the CRON_SECRET environment variable and checks either:
 * - Authorization: Bearer <secret>
 * - X-Cron-Secret: <secret>
 */
export function authorizeCronRequest(request: Request): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    throw new Error('CRON_SECRET environment variable is required for cron endpoints');
  }

  const headerSecret = request.headers.get('x-cron-secret');
  const authHeader = request.headers.get('authorization');

  const bearerSecret = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : null;

  const providedSecret = headerSecret || bearerSecret;

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



