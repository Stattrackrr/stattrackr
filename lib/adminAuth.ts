import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type AdminAuthResult =
  | { authorized: true; userId: string }
  | { authorized: false; response: NextResponse };

/**
 * Validate that a request is authorized for admin endpoints.
 * Requires ADMIN_SECRET environment variable or authenticated admin user.
 * Checks:
 * - Authorization: Bearer <ADMIN_SECRET>
 * - X-Admin-Secret: <ADMIN_SECRET>
 * - Query parameter: ?secret=<ADMIN_SECRET>
 * - OR authenticated user with admin email in ADMIN_EMAILS env var
 */
export async function authorizeAdminRequest(request: Request): Promise<AdminAuthResult> {
  const adminSecret = process.env.ADMIN_SECRET;
  const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];

  // Method 1: Check for admin secret (similar to CRON_SECRET)
  if (adminSecret) {
    const headerSecret = request.headers.get('x-admin-secret');
    const authHeader = request.headers.get('authorization');
    const bearerSecret = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;

    let querySecret = null;
    try {
      const url = new URL(request.url);
      querySecret = url.searchParams.get('secret');
    } catch (e) {
      // Ignore URL parsing errors
    }

    const providedSecret = querySecret || headerSecret || bearerSecret;
    if (providedSecret && providedSecret === adminSecret) {
      return { authorized: true, userId: 'admin-secret' };
    }
  }

  // Method 2: Check for authenticated admin user
  try {
    const supabase = await createClient();
    const { data: { session }, error: authError } = await supabase.auth.getSession();

    if (session?.user && !authError) {
      const userEmail = session.user.email?.toLowerCase();
      
      // Check if user email is in admin emails list
      if (userEmail && adminEmails.length > 0 && adminEmails.includes(userEmail)) {
        return { authorized: true, userId: session.user.id };
      }
    }
  } catch (error) {
    // Auth check failed - continue to unauthorized response
  }

  // Not authorized
  return {
    authorized: false,
    response: NextResponse.json(
      {
        error: 'Unauthorized - Admin access required',
      },
      { status: 403 }
    ),
  };
}

