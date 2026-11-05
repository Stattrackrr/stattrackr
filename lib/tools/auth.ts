/**
 * Admin gate for /api/tools/*.
 * Tools client sends Authorization: Bearer <supabase access token>,
 * which authorizeAdminRequest treats as ADMIN_SECRET — so we also
 * resolve the JWT to a user and match admin emails.
 */

import { authorizeAdminRequest } from '@/lib/adminAuth';
import { isDataAdminEmail } from '@/lib/adminEmail';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

function adminEmailSet(): Set<string> {
  const fromEnv = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(fromEnv);
}

export async function allowToolsAdmin(request: Request): Promise<boolean> {
  if (process.env.TOOLS_DEV_OPEN === '1') return true;

  const admin = await authorizeAdminRequest(request);
  if (admin.authorized) return true;

  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;

  // Bearer may be ADMIN_SECRET (already checked) or a user JWT.
  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);
    if (error || !user?.email) return false;
    const email = user.email.trim().toLowerCase();
    if (isDataAdminEmail(email)) return true;
    return adminEmailSet().has(email);
  } catch {
    return false;
  }
}
