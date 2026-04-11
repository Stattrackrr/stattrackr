export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { buildTrustedAppUrl } from '@/lib/appUrl';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';

const TRIAL_IMMEDIATE_CANCEL_EFFECTIVE_AT = process.env.TRIAL_IMMEDIATE_CANCEL_EFFECTIVE_AT;

function getTrialImmediateCancelCutoffMs(): number | null {
  if (!TRIAL_IMMEDIATE_CANCEL_EFFECTIVE_AT) return null;
  const parsedMs = Date.parse(TRIAL_IMMEDIATE_CANCEL_EFFECTIVE_AT);
  if (Number.isNaN(parsedMs)) {
    console.warn(
      `Invalid TRIAL_IMMEDIATE_CANCEL_EFFECTIVE_AT value: ${TRIAL_IMMEDIATE_CANCEL_EFFECTIVE_AT}`
    );
    return null;
  }
  return parsedMs;
}

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
      .select('stripe_customer_id, subscription_status, trial_used_at')
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
    let isTrialing = profile.subscription_status === 'trialing';
    let stripeTrialCreatedMs: number | null = null;
    const trialConfigId = process.env.STRIPE_PORTAL_CONFIG_TRIAL;
    const paidConfigId = process.env.STRIPE_PORTAL_CONFIG_PAID;
    // Prefer Stripe as source-of-truth to avoid stale DB status routing.
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        status: 'all',
        limit: 10,
      });
      const trialingSubscriptions = subscriptions.data.filter((sub) => sub.status === 'trialing');
      const hasTrialingSubscription = trialingSubscriptions.length > 0;
      isTrialing = hasTrialingSubscription;
      if (hasTrialingSubscription) {
        stripeTrialCreatedMs = Math.max(...trialingSubscriptions.map((sub) => sub.created * 1000));
      }
    } catch (statusError: any) {
      console.warn('Portal - Could not confirm trial status from Stripe, using profile status', {
        code: statusError?.code,
        type: statusError?.type,
      });
    }
    const cutoffMs = getTrialImmediateCancelCutoffMs();
    const trialUsedAtMs = profile.trial_used_at ? Date.parse(profile.trial_used_at) : NaN;
    const trialStartMs = Number.isNaN(trialUsedAtMs) ? stripeTrialCreatedMs : trialUsedAtMs;
    const isNewTrialForImmediateCancel =
      isTrialing && (cutoffMs === null || (trialStartMs !== null && trialStartMs >= cutoffMs));
    const selectedConfigId = isNewTrialForImmediateCancel ? trialConfigId : paidConfigId;

    if (isNewTrialForImmediateCancel && !trialConfigId) {
      console.warn('Portal - Trial user without STRIPE_PORTAL_CONFIG_TRIAL, falling back to default portal config');
    }

    const returnUrl = buildTrustedAppUrl('/subscription', {
      requestedOrigin: request.headers.get('origin'),
      fallbackOrigin: request.nextUrl.origin,
    });
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
      isNewTrialForImmediateCancel,
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
