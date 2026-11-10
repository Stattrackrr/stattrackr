import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import {
  REFERRAL_FRIEND_PERCENT,
  REFERRAL_PAST_DUE_GRACE_DAYS,
  couponIdForPercent,
  isReferralCouponId,
  type ReferralCouponPercent,
} from './constants';
import {
  applyCustomerBalanceCredit,
  computeTierIncreaseCreditCents,
  getSubscriptionPeriodAmountCents,
} from './credit';
import { emailFriendBecameActive, emailFriendEnded, emailFriendSignedUp } from './emails';
import { effectiveReferralPercent } from './tiers';

type ProfileRow = {
  id: string;
  email: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  subscription_tier: string | null;
  referral_discount_locked: boolean | null;
  referral_coupon_percent: number | null;
  pending_referral_coupon_percent: number | null;
  referred_by_user_id: string | null;
  subscription_ended_at?: string | null;
};

function asPercent(n: number | null | undefined): ReferralCouponPercent {
  if (n === 35 || n === 30 || n === 20) return n;
  return 0;
}

async function getProfile(supabase: SupabaseClient, userId: string): Promise<ProfileRow | null> {
  const { data } = await supabase
    .from('profiles')
    .select(
      'id, email, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_tier, referral_discount_locked, referral_coupon_percent, pending_referral_coupon_percent, referred_by_user_id, subscription_ended_at'
    )
    .eq('id', userId)
    .maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

export async function countActiveReferrals(
  supabase: SupabaseClient,
  referrerUserId: string
): Promise<number> {
  const { count } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_user_id', referrerUserId)
    .eq('status', 'active');
  return count ?? 0;
}

function subscriptionCanceling(sub: Stripe.Subscription | null): boolean {
  return Boolean(sub?.cancel_at_period_end || sub?.cancel_at);
}

function isEntitlingStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'active' || s === 'trialing';
}

async function loadSubscription(
  stripe: Stripe,
  subscriptionId: string | null | undefined
): Promise<Stripe.Subscription | null> {
  if (!subscriptionId) return null;
  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    return null;
  }
}

/** Current referral coupon id on a Stripe subscription, if any. */
function currentReferralCouponId(sub: Stripe.Subscription): string | null {
  const discounts = (sub as any).discounts as Array<{ coupon?: Stripe.Coupon | string }> | undefined;
  if (Array.isArray(discounts)) {
    for (const d of discounts) {
      const id = typeof d.coupon === 'string' ? d.coupon : d.coupon?.id;
      if (isReferralCouponId(id)) return id ?? null;
    }
  }
  const legacy = (sub as any).discount?.coupon;
  const legacyId = typeof legacy === 'string' ? legacy : legacy?.id;
  if (isReferralCouponId(legacyId)) return legacyId ?? null;
  return null;
}

function hasNonReferralDiscount(sub: Stripe.Subscription): boolean {
  const discounts = (sub as any).discounts as Array<{ coupon?: Stripe.Coupon | string }> | undefined;
  if (Array.isArray(discounts) && discounts.length > 0) {
    return discounts.some((d) => {
      const id = typeof d.coupon === 'string' ? d.coupon : d.coupon?.id;
      return id && !isReferralCouponId(id);
    });
  }
  const legacy = (sub as any).discount?.coupon;
  const legacyId = typeof legacy === 'string' ? legacy : legacy?.id;
  return Boolean(legacyId && !isReferralCouponId(legacyId));
}

/**
 * Apply / schedule the correct referral coupon for a user.
 * - Increases: customer balance credit now; coupon from next renewal (pending stored).
 * - Decreases: pending for next renewal; keep current coupon until then.
 * - Does not touch non-referral marketing coupons on live subs.
 */
export async function reconcileUserReferralDiscount(
  supabase: SupabaseClient,
  stripe: Stripe,
  userId: string,
  opts?: { forceApplyPending?: boolean; reason?: string }
): Promise<{ percent: ReferralCouponPercent; applied: boolean }> {
  const profile = await getProfile(supabase, userId);
  if (!profile) return { percent: 0, applied: false };

  if (profile.referral_discount_locked) {
    return { percent: asPercent(profile.referral_coupon_percent), applied: false };
  }

  const activeCount = await countActiveReferrals(supabase, userId);
  const target = effectiveReferralPercent({
    isReferredFriend: Boolean(profile.referred_by_user_id),
    activeFriendCountAsReferrer: activeCount,
  });

  const sub = await loadSubscription(stripe, profile.stripe_subscription_id);
  if (!sub || !['active', 'trialing', 'past_due'].includes(sub.status)) {
    await supabase
      .from('profiles')
      .update({
        pending_referral_coupon_percent: target,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    return { percent: target, applied: false };
  }

  // Don't overwrite a live marketing promo — wait until it ends.
  if (hasNonReferralDiscount(sub) && !currentReferralCouponId(sub)) {
    await supabase
      .from('profiles')
      .update({
        pending_referral_coupon_percent: target,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    console.log(
      `[referral] user ${userId}: marketing promo present; deferred referral ${target}%`
    );
    return { percent: target, applied: false };
  }

  const currentApplied = asPercent(profile.referral_coupon_percent);
  const pending = asPercent(profile.pending_referral_coupon_percent);

  // Apply deferred decrease/increase at renewal boundary.
  if (opts?.forceApplyPending && pending !== currentApplied) {
    await setSubscriptionReferralCoupon(stripe, sub, pending);
    await supabase
      .from('profiles')
      .update({
        referral_coupon_percent: pending,
        pending_referral_coupon_percent: pending,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    return { percent: pending, applied: true };
  }

  if (target === currentApplied) {
    await supabase
      .from('profiles')
      .update({
        pending_referral_coupon_percent: target,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    // Ensure Stripe still has the coupon if we own it
    const onSub = currentReferralCouponId(sub);
    const wantId = couponIdForPercent(target);
    if ((wantId || null) !== (onSub || null) && !hasNonReferralDiscount(sub)) {
      await setSubscriptionReferralCoupon(stripe, sub, target);
    }
    return { percent: target, applied: false };
  }

  if (target > currentApplied) {
    // Tier increase: credit remaining days, schedule new coupon at renewal.
    const periodStart = (sub as any).current_period_start as number;
    const periodEnd = (sub as any).current_period_end as number;
    const amountCents = await getSubscriptionPeriodAmountCents(stripe, sub);
    const credit = computeTierIncreaseCreditCents({
      periodStartSec: periodStart,
      periodEndSec: periodEnd,
      periodAmountCents: amountCents,
      oldPercent: currentApplied,
      newPercent: target,
    });
    if (credit > 0 && profile.stripe_customer_id) {
      await applyCustomerBalanceCredit(
        stripe,
        profile.stripe_customer_id,
        credit,
        sub.currency || 'aud',
        `Referral tier increase ${currentApplied}% → ${target}%`
      );
    }
    // Keep current coupon until renewal; store pending target.
    // Also attach the new coupon now with proration none — Stripe applies from next invoice
    // for coupon-only changes, which matches "new rate from next renewal" while credit covers remainder.
    await setSubscriptionReferralCoupon(stripe, sub, target);
    await supabase
      .from('profiles')
      .update({
        referral_coupon_percent: target,
        pending_referral_coupon_percent: target,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    return { percent: target, applied: true };
  }

  // Tier decrease: keep current coupon, set pending for next renewal.
  await supabase
    .from('profiles')
    .update({
      pending_referral_coupon_percent: target,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  console.log(
    `[referral] user ${userId}: decrease ${currentApplied}% → ${target}% deferred to renewal (${opts?.reason || 'n/a'})`
  );
  return { percent: currentApplied, applied: false };
}

async function setSubscriptionReferralCoupon(
  stripe: Stripe,
  sub: Stripe.Subscription,
  percent: ReferralCouponPercent
): Promise<void> {
  const couponId = couponIdForPercent(percent);
  if (!couponId) {
    // Remove only referral discounts; if somehow mixed, clear discounts array carefully.
    const onSub = currentReferralCouponId(sub);
    if (!onSub && !hasNonReferralDiscount(sub) && !(sub as any).discount) return;
    if (hasNonReferralDiscount(sub)) return;
    await stripe.subscriptions.update(sub.id, {
      discounts: '',
      proration_behavior: 'none',
    } as any);
    return;
  }

  await stripe.subscriptions.update(sub.id, {
    discounts: [{ coupon: couponId }],
    proration_behavior: 'none',
  });
}

/** Record pending referral at checkout (before payment). */
export async function recordPendingReferral(
  supabase: SupabaseClient,
  opts: {
    referrerUserId: string;
    referredUserId: string;
    referralCode: string;
    stripeSubscriptionId?: string | null;
  }
): Promise<void> {
  await supabase.from('profiles').update({
    referred_by_user_id: opts.referrerUserId,
    updated_at: new Date().toISOString(),
  }).eq('id', opts.referredUserId);

  await supabase.from('referrals').upsert(
    {
      referrer_user_id: opts.referrerUserId,
      referred_user_id: opts.referredUserId,
      referral_code: opts.referralCode,
      status: 'pending',
      stripe_subscription_id: opts.stripeSubscriptionId ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'referred_user_id' }
  );

  const referrer = await getProfile(supabase, opts.referrerUserId);
  const referred = await getProfile(supabase, opts.referredUserId);
  if (referrer?.email) {
    await emailFriendSignedUp(
      referrer.email,
      referred?.email || 'Your friend'
    );
  }
}

/** Activate referral after first successful payment. */
export async function activateReferralForSubscription(
  supabase: SupabaseClient,
  stripe: Stripe,
  opts: {
    referredUserId: string;
    stripeSubscriptionId: string;
    cardFingerprint?: string | null;
  }
): Promise<void> {
  const { data: referral } = await supabase
    .from('referrals')
    .select('*')
    .eq('referred_user_id', opts.referredUserId)
    .maybeSingle();

  if (!referral) return;
  if (referral.status === 'active') {
    await reconcileUserReferralDiscount(supabase, stripe, referral.referrer_user_id);
    await reconcileUserReferralDiscount(supabase, stripe, opts.referredUserId);
    return;
  }
  if (referral.status === 'disqualified' || referral.status === 'ended') return;

  const referrer = await getProfile(supabase, referral.referrer_user_id);
  const referrerSub = await loadSubscription(stripe, referrer?.stripe_subscription_id);
  const referrerCanEarn =
    referrer &&
    isEntitlingStatus(referrer.subscription_status) &&
    referrer.subscription_tier === 'pro' &&
    !subscriptionCanceling(referrerSub);

  await supabase
    .from('referrals')
    .update({
      status: 'active',
      activated_at: new Date().toISOString(),
      stripe_subscription_id: opts.stripeSubscriptionId,
      card_fingerprint: opts.cardFingerprint ?? referral.card_fingerprint,
      updated_at: new Date().toISOString(),
    })
    .eq('id', referral.id);

  // Friend always gets 20% (or higher if they already have a tier).
  await reconcileUserReferralDiscount(supabase, stripe, opts.referredUserId, {
    reason: 'friend_activated',
  });

  if (referrerCanEarn) {
    const before = await countActiveReferrals(supabase, referral.referrer_user_id);
    const result = await reconcileUserReferralDiscount(supabase, stripe, referral.referrer_user_id, {
      reason: 'friend_activated',
    });
    if (referrer?.email) {
      await emailFriendBecameActive(
        referrer.email,
        (await getProfile(supabase, opts.referredUserId))?.email || 'Your friend',
        result.percent
      );
    }
    console.log(
      `[referral] activated ${referral.id}; referrer ${referral.referrer_user_id} active≈${before} → ${result.percent}%`
    );
  } else {
    console.log(
      `[referral] activated ${referral.id}; referrer cannot earn tiers yet (pending cancel / not pro)`
    );
  }
}

export async function endReferral(
  supabase: SupabaseClient,
  stripe: Stripe,
  opts: {
    referredUserId?: string;
    stripeSubscriptionId?: string;
    reason: string;
  }
): Promise<void> {
  let query = supabase.from('referrals').select('*');
  if (opts.referredUserId) query = query.eq('referred_user_id', opts.referredUserId);
  else if (opts.stripeSubscriptionId) query = query.eq('stripe_subscription_id', opts.stripeSubscriptionId);
  else return;

  const { data: referral } = await query.maybeSingle();
  if (!referral || referral.status === 'ended' || referral.status === 'disqualified') return;

  await supabase
    .from('referrals')
    .update({
      status: 'ended',
      ended_at: new Date().toISOString(),
      end_reason: opts.reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', referral.id);

  const result = await reconcileUserReferralDiscount(supabase, stripe, referral.referrer_user_id, {
    reason: opts.reason,
  });
  const referrer = await getProfile(supabase, referral.referrer_user_id);
  if (referrer?.email) {
    await emailFriendEnded(
      referrer.email,
      (await getProfile(supabase, referral.referred_user_id))?.email || 'Your friend',
      asPercent(referrer.pending_referral_coupon_percent ?? result.percent)
    );
  }
}

/** Mark subscription ended on profile for 30-day rejoin gap. */
export async function markSubscriptionEnded(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  await supabase
    .from('profiles')
    .update({
      subscription_ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
}

/**
 * Re-evaluate whether a past_due referred friend should drop after grace.
 */
export async function maybeExpirePastDueReferral(
  supabase: SupabaseClient,
  stripe: Stripe,
  subscription: Stripe.Subscription
): Promise<void> {
  if (subscription.status !== 'past_due') return;
  const periodEnd = (subscription as any).current_period_end as number | undefined;
  // Use billing_cycle_anchor / first past_due time approx: if period ended + grace passed.
  const graceCutoff = Math.floor(Date.now() / 1000) - REFERRAL_PAST_DUE_GRACE_DAYS * 24 * 60 * 60;
  if (periodEnd && periodEnd > graceCutoff) return;

  await endReferral(supabase, stripe, {
    stripeSubscriptionId: subscription.id,
    reason: 'past_due_grace_elapsed',
  });
}

export { REFERRAL_FRIEND_PERCENT };
