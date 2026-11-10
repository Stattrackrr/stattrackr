export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { authorizeAdminRequest } from '@/lib/adminAuth';
import { getStripe } from '@/lib/stripe';
import { reconcileUserReferralDiscount } from '@/lib/referral/reconcile';

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase service credentials');
  return createServiceClient(url, key);
}

/** GET: list referrals (optional ?referrer=userId) */
export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.authorized) return auth.response;

  const service = getServiceSupabase();
  const referrer = request.nextUrl.searchParams.get('referrer');
  let query = service
    .from('referrals')
    .select(
      'id, referrer_user_id, referred_user_id, referral_code, status, activated_at, ended_at, end_reason, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(200);
  if (referrer) query = query.eq('referrer_user_id', referrer);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const referrerIds = Array.from(new Set((data || []).map((r) => r.referrer_user_id)));
  const { data: profiles } = await service
    .from('profiles')
    .select(
      'id, email, referral_code, referral_coupon_percent, pending_referral_coupon_percent, referral_discount_locked'
    )
    .in('id', referrerIds.length ? referrerIds : ['00000000-0000-0000-0000-000000000000']);

  return NextResponse.json({ referrals: data || [], referrers: profiles || [] });
}

/**
 * POST body:
 * { action: 'lock' | 'unlock' | 'remove_discount' | 'reconcile', userId: string }
 */
export async function POST(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.authorized) return auth.response;

  const body = await request.json();
  const { action, userId } = body as { action?: string; userId?: string };
  if (!userId || !action) {
    return NextResponse.json({ error: 'userId and action required' }, { status: 400 });
  }

  const service = getServiceSupabase();
  const stripe = getStripe();

  if (action === 'lock') {
    await service
      .from('profiles')
      .update({ referral_discount_locked: true, updated_at: new Date().toISOString() })
      .eq('id', userId);
    return NextResponse.json({ ok: true, locked: true });
  }

  if (action === 'unlock') {
    await service
      .from('profiles')
      .update({ referral_discount_locked: false, updated_at: new Date().toISOString() })
      .eq('id', userId);
    const result = await reconcileUserReferralDiscount(service, stripe, userId, {
      reason: 'admin_unlock',
    });
    return NextResponse.json({ ok: true, locked: false, result });
  }

  if (action === 'remove_discount') {
    const { data: profile } = await service
      .from('profiles')
      .select('stripe_subscription_id')
      .eq('id', userId)
      .maybeSingle();
    if (profile?.stripe_subscription_id) {
      await stripe.subscriptions.update(profile.stripe_subscription_id, {
        discounts: '',
        proration_behavior: 'none',
      } as any);
    }
    await service
      .from('profiles')
      .update({
        referral_coupon_percent: 0,
        pending_referral_coupon_percent: 0,
        referral_discount_locked: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    return NextResponse.json({ ok: true, removed: true, locked: true });
  }

  if (action === 'reconcile') {
    const result = await reconcileUserReferralDiscount(service, stripe, userId, {
      forceApplyPending: true,
      reason: 'admin_reconcile',
    });
    return NextResponse.json({ ok: true, result });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
