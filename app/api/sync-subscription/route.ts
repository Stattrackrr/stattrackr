export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe';
import { reconcileUserSubscription } from '@/lib/stripeCustomer';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is required');
}
if (!supabaseServiceKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, email')
      .eq('id', user.id)
      .single();

    const reconciled = await reconcileUserSubscription(
      supabase,
      {
        userId: user.id,
        email: user.email || profile?.email,
        knownCustomerId: profile?.stripe_customer_id,
      },
      {
        stripe: getStripe(),
        cancelDuplicates: true,
        persist: true,
      }
    );

    if (!reconciled.subscription) {
      return NextResponse.json({
        message: 'No active subscription found',
        subscription: null,
        customerId: reconciled.customerId,
      });
    }

    return NextResponse.json({
      message: 'Subscription synced successfully',
      subscription: {
        status: reconciled.subscription.status,
        tier: reconciled.entitling ? 'pro' : 'free',
        billingCycle: reconciled.profileUpdates.subscription_billing_cycle,
        currentPeriodEnd: reconciled.profileUpdates.subscription_current_period_end,
        customerId: reconciled.customerId,
        subscriptionId: reconciled.subscription.id,
      },
      canceledDuplicates: reconciled.canceledDuplicateIds,
    });
  } catch (error: any) {
    console.error('Sync subscription error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to sync subscription' },
      { status: 500 }
    );
  }
}
