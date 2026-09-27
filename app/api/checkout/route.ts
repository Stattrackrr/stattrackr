export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getStripe, PRICE_IDS } from '@/lib/stripe';
import {
  reconcileUserSubscription,
  resolveOrCreateStripeCustomer,
} from '@/lib/stripeCustomer';

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
    const { priceId, billingCycle } = body;

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

    // Reconcile across every Stripe customer for this user before allowing checkout.
    // Restores access if an entitling sub exists on a non-linked customer and cancels duplicates.
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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin')}/props?success=true&billing=${billingCycle}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin')}/props`,
      metadata: {
        user_id: user.id,
        billing_cycle: billingCycle,
        has_trial: 'false',
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
