export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { ensureReferralCode } from '@/lib/referral/codes';
import { nextTierInfo, referrerTierPercent } from '@/lib/referral/tiers';
import { REFERRAL_FRIEND_PERCENT, REFERRAL_MAX_PERCENT } from '@/lib/referral/constants';

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service credentials');
  return createServiceClient(url, key);
}

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const supabase = await createClient();
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const {
      data: { user },
      error,
    } = token ? await supabase.auth.getUser(token) : await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const service = getServiceSupabase();
    const code = await ensureReferralCode(service, user.id);
    // Prefer the live request host so share links match the site (.co), not a stale APP_URL.
    const host =
      request.headers.get('x-forwarded-host') || request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') || 'https';
    const origin = (
      request.headers.get('origin') ||
      (host ? `${proto}://${host}` : null) ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      'https://www.stattrackr.co'
    ).replace(/\/$/, '');
    const link = `${origin}/pricing?ref=${encodeURIComponent(code)}`;

    const { data: profile } = await service
      .from('profiles')
      .select(
        'subscription_status, subscription_tier, referral_coupon_percent, pending_referral_coupon_percent, referred_by_user_id, referral_discount_locked'
      )
      .eq('id', user.id)
      .maybeSingle();

    const { data: referrals } = await service
      .from('referrals')
      .select('id, status, activated_at, ended_at, created_at, referred_user_id')
      .eq('referrer_user_id', user.id)
      .order('created_at', { ascending: false });

    const list = referrals || [];
    const activeCount = list.filter((r) => r.status === 'active').length;
    const referredCount = list.length;
    const currentPercent = referrerTierPercent(activeCount);
    const appliedPercent = Number(profile?.referral_coupon_percent) || 0;
    const pendingPercent =
      profile?.pending_referral_coupon_percent != null
        ? Number(profile.pending_referral_coupon_percent)
        : currentPercent;
    const next = nextTierInfo(activeCount);

    return NextResponse.json({
      code,
      link,
      referredCount,
      activeCount,
      currentPercent,
      appliedPercent,
      pendingPercent,
      nextTier: next.nextPercent,
      nextActiveNeeded: next.nextCount,
      isReferredFriend: Boolean(profile?.referred_by_user_id),
      friendPercent: profile?.referred_by_user_id ? REFERRAL_FRIEND_PERCENT : 0,
      maxPercent: REFERRAL_MAX_PERCENT,
      locked: Boolean(profile?.referral_discount_locked),
      isPro:
        (profile?.subscription_status === 'active' ||
          profile?.subscription_status === 'trialing') &&
        profile?.subscription_tier === 'pro',
      referrals: list.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        activatedAt: r.activated_at,
        endedAt: r.ended_at,
      })),
    });
  } catch (err: any) {
    console.error('[referral/me]', err);
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
