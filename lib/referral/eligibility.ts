import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { REFERRAL_REJOIN_GAP_DAYS } from './constants';

export type FriendEligibility =
  | { ok: true }
  | { ok: false; reason: string };

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

/**
 * Friend discount eligibility at Checkout.
 * Not eligible if they currently have an entitling/running subscription
 * (including cancel_at_period_end). Returning customers need a 30-day gap
 * after subscription_ended_at.
 */
export async function checkFriendReferralEligibility(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    stripe?: Stripe;
    stripeCustomerId?: string | null;
  }
): Promise<FriendEligibility> {
  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'id, email, subscription_status, subscription_tier, stripe_subscription_id, stripe_customer_id, subscription_ended_at, referred_by_user_id'
    )
    .eq('id', opts.userId)
    .maybeSingle();

  if (!profile) return { ok: false, reason: 'Profile not found' };

  const status = String(profile.subscription_status || '').toLowerCase();
  const entitling =
    status === 'active' ||
    status === 'trialing' ||
    status === 'past_due' ||
    status === 'unpaid';

  if (entitling && profile.subscription_tier === 'pro') {
    return {
      ok: false,
      reason:
        'You already have an active subscription. Referral discounts are only for new sign-ups after your current plan fully ends.',
    };
  }

  // If Stripe says they still have a live/canceling sub, block.
  if (opts.stripe && (opts.stripeCustomerId || profile.stripe_customer_id)) {
    const customerId = opts.stripeCustomerId || profile.stripe_customer_id;
    if (customerId) {
      try {
        const subs = await opts.stripe.subscriptions.list({
          customer: customerId,
          status: 'all',
          limit: 10,
        });
        const blocking = subs.data.find((s) =>
          ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(s.status)
        );
        if (blocking) {
          return {
            ok: false,
            reason:
              'Your subscription is still running (including if it is set to cancel at period end). Wait until it fully ends before using a referral.',
          };
        }
      } catch (err) {
        console.warn('[referral] eligibility stripe list failed', err);
      }
    }
  }

  const gapDays = daysSince(profile.subscription_ended_at);
  if (gapDays != null && gapDays < REFERRAL_REJOIN_GAP_DAYS) {
    const remaining = Math.ceil(REFERRAL_REJOIN_GAP_DAYS - gapDays);
    return {
      ok: false,
      reason: `Returning customers can use a referral after ${REFERRAL_REJOIN_GAP_DAYS} days from their last subscription ending (${remaining} day${remaining === 1 ? '' : 's'} left).`,
    };
  }

  // Already attributed and paid under another referrer — don't re-attribute.
  if (profile.referred_by_user_id) {
    const { data: existing } = await supabase
      .from('referrals')
      .select('id, status')
      .eq('referred_user_id', opts.userId)
      .maybeSingle();
    if (existing && existing.status !== 'ended' && existing.status !== 'disqualified') {
      return { ok: false, reason: 'This account is already linked to a referral.' };
    }
  }

  return { ok: true };
}

export function isSelfReferral(opts: {
  referrerUserId: string;
  referredUserId: string;
  referrerEmail?: string | null;
  referredEmail?: string | null;
  cardFingerprint?: string | null;
  referrerCardFingerprints?: string[];
}): { ok: true } | { ok: false; reason: string } {
  if (opts.referrerUserId === opts.referredUserId) {
    return { ok: false, reason: 'You cannot use your own referral link.' };
  }
  const a = (opts.referrerEmail || '').trim().toLowerCase();
  const b = (opts.referredEmail || '').trim().toLowerCase();
  if (a && b && a === b) {
    return { ok: false, reason: 'You cannot use your own referral link.' };
  }
  if (
    opts.cardFingerprint &&
    opts.referrerCardFingerprints?.length &&
    opts.referrerCardFingerprints.includes(opts.cardFingerprint)
  ) {
    return { ok: false, reason: 'Self-referrals are not allowed.' };
  }
  return { ok: true };
}
