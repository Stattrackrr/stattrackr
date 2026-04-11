import { NextResponse } from 'next/server';

type CronAuthResult =
  | { authorized: true }
  | { authorized: false; response: NextResponse };

function normalizeSecret(s: string): string {
  return (s ?? '').replace(/\r\n|\r|\n/g, '').trim();
}

/**
 * Validate that a request is authorized to trigger cron endpoints.
 * Checks: x-vercel-cron: 1, Authorization: Bearer <CRON_SECRET>, X-Cron-Secret, or ?secret=
 * Comparison is normalized (trim, strip newlines) so env var newlines don't cause 401.
 */
export function authorizeCronRequest(request: Request): CronAuthResult {
  const cronSecret = normalizeSecret(process.env.CRON_SECRET ?? '');

  const vercelCronHeader = normalizeSecret(request.headers.get('x-vercel-cron') ?? '').toLowerCase();
  const isVercelCronHeader =
    !!vercelCronHeader &&
    vercelCronHeader !== '0' &&
    vercelCronHeader !== 'false' &&
    vercelCronHeader !== 'no';

  if (!cronSecret) {
    console.warn('[Cron auth] 401: CRON_SECRET is not configured');
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Unauthorized cron access', hint: 'CRON_SECRET is not configured on this deployment environment.' },
        { status: 401 }
      ),
    };
  }

  const headerSecret = normalizeSecret(request.headers.get('x-cron-secret') ?? '');
  const authHeader = request.headers.get('authorization');
  const bearerSecret =
    authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  const authSecret = normalizeSecret(bearerSecret ?? '');

  let querySecret = '';
  try {
    const q = new URL(request.url).searchParams.get('secret');
    querySecret = normalizeSecret(q ?? '');
  } catch {
    // ignore
  }

  const provided = normalizeSecret(querySecret || headerSecret || authSecret);

  if (!provided || provided !== cronSecret) {
    const reason = !provided
      ? 'no secret in request (send Authorization: Bearer CRON_SECRET, X-Cron-Secret, or ?secret=)'
      : 'secret mismatch (check CRON_SECRET has no extra spaces/newlines in deployment env)';
    if (isVercelCronHeader) {
      console.warn('[Cron auth] Received x-vercel-cron without a valid shared secret');
    }
    console.warn('[Cron auth] 401:', reason);
    return {
      authorized: false,
      response: NextResponse.json(
        { error: 'Unauthorized cron access', hint: reason },
        { status: 401 }
      ),
    };
  }

  return { authorized: true };
}




