export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key-' + 'x'.repeat(100)
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover',
});

export async function POST(req: NextRequest) {
  try {
    // Get user from Authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ 
        error: 'No Stripe customer found. Complete a checkout first.' 
      }, { status: 400 });
    }

    // Get customer's subscriptions from Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: 'all',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      // No active subscription
      await supabase
        .from('profiles')
        .update({
          subscription_status: null,
          subscription_tier: 'free',
          subscription_billing_cycle: null,
          subscription_current_period_end: null,
        })
        .eq('id', user.id);

      return NextResponse.json({ 
        message: 'No active subscription found',
        subscription: null 
      });
    }

    const subscription = subscriptions.data[0] as any;
    
    // Determine billing cycle from price
    let billingCycle = 'monthly';
    const priceId = subscription.items.data[0]?.price.id;
    if (priceId?.includes('annual')) {
      billingCycle = 'annual';
    } else if (priceId?.includes('semiannual')) {
      billingCycle = 'semiannual';
    }

    // Update profile with subscription info
    const updates = {
      subscription_status: subscription.status,
      subscription_tier: 'pro',
      subscription_billing_cycle: billingCycle,
      subscription_current_period_end: subscription.current_period_end 
        ? new Date((subscription.current_period_end as number) * 1000).toISOString()
        : null,
    };

    const { error: updateError } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id);

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      message: 'Subscription synced successfully',
      subscription: {
        status: subscription.status,
        tier: 'pro',
        billingCycle,
        currentPeriodEnd: subscription.current_period_end
          ? new Date((subscription.current_period_end as number) * 1000).toISOString()
          : null,
      },
    });
  } catch (error: any) {
    console.error('Sync subscription error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync subscription' },
      { status: 500 }
    );
  }
}
