export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getStripe, PRICE_IDS } from '@/lib/stripe';
import {
  reconcileUserSubscription,
  resolveOrCreateStripeCustomer,
} from '@/lib/stripeCustomer';
import { REFERRAL_COUPON_IDS } from '@/lib/referral/constants';
import { findReferrerByCode, normalizeReferralCode } from '@/lib/referral/codes';
import {
  checkFriendReferralEligibility,
  isSelfReferral,
} from '@/lib/referral/eligibility';

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase service credentials are required for checkout');
  }
  return createServiceClient(url, key);
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized - Missing token' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7);
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { priceId, billingCycle, referralCode: rawReferralCode } = body;

    const validPriceIds = Object.values(PRICE_IDS.pro);
    if (!validPriceIds.includes(priceId)) {
      return NextResponse.json({ error: 'Invalid price ID' }, { status: 400 });
    }

    const stripe = getStripe();
    const serviceSupabase = getServiceSupabase();

    const { data: profile, error: profileError } = await serviceSupabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (profileError && profileError.code !== 'PGRST116') {
      console.error('[Checkout] Error fetching profile:', profileError);
    }

    const identity = {
      userId: user.id,
      email: user.email,
      knownCustomerId: profile?.stripe_customer_id,
    };

    const reconciled = await reconcileUserSubscription(serviceSupabase, identity, {
      stripe,
      cancelDuplicates: true,
      persist: true,
    });

    if (reconciled.entitling) {
      console.log(
        `[Checkout] User ${user.id} already has entitling subscription ${reconciled.subscription?.id}; blocking duplicate checkout`
      );
      return NextResponse.json(
        {
          error:
            'You already have an active subscription. Access has been restored on your account.',
          alreadySubscribed: true,
          subscription: {
            status: reconciled.subscription?.status,
            customerId: reconciled.customerId,
            subscriptionId: reconciled.subscription?.id,
          },
        },
        { status: 409 }
      );
    }

    const { customerId } = await resolveOrCreateStripeCustomer(stripe, serviceSupabase, {
      ...identity,
      knownCustomerId: reconciled.customerId || identity.knownCustomerId,
    });

    const referralCode = normalizeReferralCode(rawReferralCode);
    let referrerUserId: string | null = null;
    let appliedReferralCode: string | null = null;

    if (referralCode) {
      const referrer = await findReferrerByCode(serviceSupabase, referralCode);
      if (!referrer) {
        return NextResponse.json({ error: 'Invalid referral code' }, { status: 400 });
      }

      const self = isSelfReferral({
        referrerUserId: referrer.id,
        referredUserId: user.id,
        referrerEmail: referrer.email,
        referredEmail: user.email,
      });
      if (!self.ok) {
        return NextResponse.json({ error: self.reason }, { status: 400 });
      }

      // Referrer pending cancel / not active: still allow friend 20%, but we'll freeze referrer tier later.
      const eligibility = await checkFriendReferralEligibility(serviceSupabase, {
        userId: user.id,
        stripe,
        stripeCustomerId: customerId,
      });
      if (!eligibility.ok) {
        return NextResponse.json({ error: eligibility.reason }, { status: 400 });
      }

      referrerUserId = referrer.id;
      appliedReferralCode = referrer.referral_code;
    }

    const sessionParams: Record<string, unknown> = {
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin')}/props?sport=all&success=true&billing=${billingCycle}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin')}/props?sport=all`,
      metadata: {
        user_id: user.id,
        billing_cycle: billingCycle,
        has_trial: 'false',
        ...(referrerUserId
          ? {
              referrer_user_id: referrerUserId,
              referral_code: appliedReferralCode,
            }
          : {}),
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          ...(referrerUserId
            ? {
                referrer_user_id: referrerUserId,
                referral_code: appliedReferralCode,
              }
            : {}),
        },
      },
    };

    if (referrerUserId) {
      // Stripe forbids allow_promotion_codes together with discounts — omit it entirely.
      sessionParams.discounts = [{ coupon: REFERRAL_COUPON_IDS[20] }];
    } else {
      sessionParams.allow_promotion_codes = true;
    }

    const session = await stripe.checkout.sessions.create(sessionParams as any);

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
      referralApplied: Boolean(referrerUserId),
    });
  } catch (error: any) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
