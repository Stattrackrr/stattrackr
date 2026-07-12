export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe';
import { reconcileUserSubscription } from '@/lib/stripeCustomer';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';

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
    const rateResult = checkRateLimit(req, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

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

    if (!reconciled.customerId) {
      return NextResponse.json(
        {
          error: 'No Stripe customer found with your email. Complete a checkout first.',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      message: reconciled.entitling
        ? 'Stripe customer linked and subscription restored'
        : 'Stripe customer linked successfully',
      customerId: reconciled.customerId,
      subscriptionId: reconciled.subscription?.id ?? null,
      status: reconciled.subscription?.status ?? null,
      canceledDuplicates: reconciled.canceledDuplicateIds,
    });
  } catch (error: any) {
    console.error('Find Stripe customer error:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      {
        error: isProduction
          ? 'An error occurred. Please try again later.'
          : error.message || 'Failed to find Stripe customer',
      },
      { status: 500 }
    );
  }
}
