export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';

export async function GET(request: NextRequest) {
  try {
    // Rate limiting (even with auth, prevent abuse)
    const rateResult = checkRateLimit(request, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }

    const supabase = await createClient();
    
    // Get authenticated session first
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    console.log('Portal - Session check:', { 
      hasSession: !!session, 
      userId: session?.user?.id,
      sessionError 
    });
    
    if (sessionError || !session) {
      console.log('Portal - No session, redirecting to login');
      return NextResponse.redirect(new URL('/login?redirect=/subscription', request.url));
    }
    
    const user = session.user;
    console.log('Portal - User found:', user.id);

    // Get Stripe customer ID and status from profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id, subscription_status')
      .eq('id', user.id)
      .single();

    console.log('Portal - Profile:', { profile, profileError });

    if (!profile?.stripe_customer_id) {
      console.log('Portal - No Stripe customer ID found');
      // Redirect back to subscription page with error message
      return NextResponse.redirect(
        new URL('/subscription?error=no_stripe_customer', request.url)
      );
    }

    // Create Stripe Customer Portal session
    const stripe = getStripe();
    const isTrialing = profile.subscription_status === 'trialing';
    const trialConfigId = process.env.STRIPE_PORTAL_CONFIG_TRIAL;
    const paidConfigId = process.env.STRIPE_PORTAL_CONFIG_PAID;
    const selectedConfigId = isTrialing ? trialConfigId : paidConfigId;

    if (isTrialing && !trialConfigId) {
      console.warn('Portal - Trial user without STRIPE_PORTAL_CONFIG_TRIAL, falling back to default portal config');
    }

    const returnUrl = `${request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL}/subscription`;
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
        console.warn('Portal - Invalid configuration ID, retrying with Stripe default config', {
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

    console.log('Portal - Redirecting to Stripe portal:', {
      url: portalSession.url,
      isTrialing,
      usesCustomConfig: Boolean(selectedConfigId),
    });
    return NextResponse.redirect(portalSession.url);
  } catch (error: any) {
    console.error('Portal error:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        error: isProduction 
          ? 'An error occurred. Please try again later.' 
          : (error.message || 'Internal server error')
      },
      { status: 500 }
    );
  }
}
