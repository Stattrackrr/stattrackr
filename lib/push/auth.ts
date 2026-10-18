import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** Signed-in user id from the Supabase bearer token, or null. */
export async function pushRequestUserId(request: NextRequest): Promise<string | null> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(header.slice(7));
  if (error || !data.user) return null;
  return data.user.id;
}

/** Push endpoints are https URLs on the browser vendor's push service. */
export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1000) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
