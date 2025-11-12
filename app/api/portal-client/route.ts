export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe';

// Create Supabase admin client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key-' + 'x'.repeat(100)
);

export async function POST(request: NextRequest) {
  try {
    // Get user from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    console.log('Portal Client - Auth check:', { userId: user?.id, authError });

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get Stripe customer ID from profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    console.log('Portal Client - Profile:', { profile, profileError });

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ 
        error: 'No Stripe customer found. Complete a checkout first.' 
      }, { status: 400 });
    }

    // Create Stripe Customer Portal session
    const stripe = getStripe();
    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL}/home`,
      });

      console.log('Portal Client - Created session:', portalSession.id);

      return NextResponse.json({ url: portalSession.url });
    } catch (stripeError: any) {
      // If customer doesn't exist in Stripe (e.g., switching from test to live mode)
      if (stripeError.code === 'resource_missing') {
        console.log('Invalid Stripe customer ID, clearing from profile');
        // Clear the invalid customer ID
        await supabase
          .from('profiles')
          .update({ stripe_customer_id: null, subscription_status: 'inactive', subscription_tier: 'free' })
          .eq('id', user.id);
        
        return NextResponse.json({ 
          error: 'Please complete checkout to set up your subscription.' 
        }, { status: 400 });
      }
      throw stripeError;
    }
  } catch (error: any) {
    console.error('Portal client error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
