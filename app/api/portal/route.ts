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

    // Get Stripe customer ID from profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
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
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${request.headers.get('origin')}/subscription`,
    });

    console.log('Portal - Redirecting to Stripe portal:', portalSession.url);
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
