import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { isProFromProfileRow, type ProfileSubscriptionRow } from '@/lib/profileSubscriptionGate';

/** True only for a signed-in user whose profile is an active or trialing Pro subscription. */
export async function requestIsPro(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(authHeader.slice(7));
    if (error || !user) return false;
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('subscription_status, subscription_tier')
      .eq('id', user.id)
      .single();
    return isProFromProfileRow((profile as ProfileSubscriptionRow | null) ?? null);
  } catch {
    return false;
  }
}

export function proRequiredResponse(feature: string) {
  return NextResponse.json(
    { success: false, proRequired: true, error: `${feature} is a Pro feature.` },
    { status: 403 }
  );
}
