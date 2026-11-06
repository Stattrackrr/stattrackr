/**
 * Auth gate for /api/tools/*.
 * Public feature, Pro (premium) subscription required.
 * Tools admin emails and site admins also allowed.
 * Client sends Authorization: Bearer <supabase access token>.
 */

import { authorizeAdminRequest } from '@/lib/adminAuth';
import { isToolsAdminEmail } from '@/lib/adminEmail';
import { requestIsPro } from '@/lib/server/proRouteAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

async function bearerUser(request: Request): Promise<{ id: string; email: string | null } | null> {
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token) return null;
  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    return { id: user.id, email: user.email ?? null };
  } catch {
    return null;
  }
}

/** Pro subscribers (or Tools/site admin) may use Tools APIs. */
export async function allowToolsAccess(request: Request): Promise<boolean> {
  if (process.env.TOOLS_DEV_OPEN === '1') return true;

  const admin = await authorizeAdminRequest(request);
  if (admin.authorized) return true;

  const user = await bearerUser(request);
  if (user?.email && isToolsAdminEmail(user.email)) return true;

  return requestIsPro(request);
}

/** @deprecated Use allowToolsAccess. */
export async function allowToolsAdmin(request: Request): Promise<boolean> {
  return allowToolsAccess(request);
}

export { bearerUser as toolsBearerUser };
