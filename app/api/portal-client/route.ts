export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe } from '@/lib/stripe';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const rateResult = checkRateLimit(request, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    // Get user from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    console.log('Portal Client - Auth check:', { userId: user?.id, authError });

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get Stripe customer ID and status from profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id, subscription_status')
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
    const isTrialing = profile.subscription_status === 'trialing';
    const trialConfigId = process.env.STRIPE_PORTAL_CONFIG_TRIAL;
    const paidConfigId = process.env.STRIPE_PORTAL_CONFIG_PAID;
    const selectedConfigId = isTrialing ? trialConfigId : paidConfigId;
    const returnUrl = `${request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL}/home`;

    try {

      if (isTrialing && !trialConfigId) {
        console.warn('Portal Client - Trial user without STRIPE_PORTAL_CONFIG_TRIAL, falling back to default portal config');
      }

      let portalSession;
      try {
        portalSession = await stripe.billingPortal.sessions.create({
          customer: profile.stripe_customer_id,
          return_url: returnUrl,
          ...(selectedConfigId ? { configuration: selectedConfigId } : {}),
        });
      } catch (stripeError: any) {
        const isConfigError = stripeError?.param === 'configuration';
        if (selectedConfigId && isConfigError) {
          console.warn('Portal Client - Invalid configuration ID, retrying with Stripe default config', {
            selectedConfigId,
            code: stripeError?.code,
            type: stripeError?.type,
          });
          portalSession = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: returnUrl,
          });
        } else {
          throw stripeError;
        }
      }

      console.log('Portal Client - Created session:', {
        sessionId: portalSession.id,
        isTrialing,
        usesCustomConfig: Boolean(selectedConfigId),
      });

      return NextResponse.json({ url: portalSession.url });
    } catch (stripeError: any) {
      // If customer doesn't exist in Stripe (e.g., switching from test to live mode)
      // Do not treat missing configuration as missing customer.
      const isMissingCustomer =
        stripeError.code === 'resource_missing' &&
        (stripeError.param === 'customer' ||
          String(stripeError.message || '').toLowerCase().includes('no such customer'));

      if (isMissingCustomer) {
        console.log('Invalid Stripe customer ID, clearing from profile');
        // Clear the invalid customer ID
        await supabaseAdmin
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
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : error.message || 'Internal server error' 
      },
      { status: 500 }
    );
  }
}
