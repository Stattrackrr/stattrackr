export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import {
  evaluateBadges,
  resolveDisplayedBadgeIds,
  sanitizeDisplayedBadgeIds,
} from '@/lib/badges/evaluate';
import { isDataAdminEmail } from '@/lib/adminEmail';

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service credentials');
  return createServiceClient(url, key);
}

async function getUser(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const supabase = await createClient();
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const {
    data: { user },
    error,
  } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = getServiceSupabase();
    const { data: profile } = await service
      .from('profiles')
      .select('subscription_status, subscription_tier, referred_by_user_id, displayed_badge_ids')
      .eq('id', user.id)
      .maybeSingle();

    const { count } = await service
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_user_id', user.id)
      .eq('status', 'active');

    const badges = evaluateBadges({
      createdAt: user.created_at,
      subscriptionStatus: profile?.subscription_status ?? null,
      subscriptionTier: profile?.subscription_tier ?? null,
      referredByUserId: profile?.referred_by_user_id ?? null,
      activeReferralCount: count ?? 0,
      isAdmin: isDataAdminEmail(user.email),
    });

    const stored = (profile as { displayed_badge_ids?: string[] | null } | null)?.displayed_badge_ids;
    const displayedBadgeIds = resolveDisplayedBadgeIds(badges, stored ?? null);

    return NextResponse.json({ badges, displayedBadgeIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { displayedBadgeIds?: unknown } | null;
    const service = getServiceSupabase();
    const { data: profile } = await service
      .from('profiles')
      .select('subscription_status, subscription_tier, referred_by_user_id')
      .eq('id', user.id)
      .maybeSingle();

    const { count } = await service
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_user_id', user.id)
      .eq('status', 'active');

    const badges = evaluateBadges({
      createdAt: user.created_at,
      subscriptionStatus: profile?.subscription_status ?? null,
      subscriptionTier: profile?.subscription_tier ?? null,
      referredByUserId: profile?.referred_by_user_id ?? null,
      activeReferralCount: count ?? 0,
      isAdmin: isDataAdminEmail(user.email),
    });

    const displayedBadgeIds = sanitizeDisplayedBadgeIds(badges, body?.displayedBadgeIds);

    const { error: updateError } = await service
      .from('profiles')
      .update({ displayed_badge_ids: displayedBadgeIds })
      .eq('id', user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ badges, displayedBadgeIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
