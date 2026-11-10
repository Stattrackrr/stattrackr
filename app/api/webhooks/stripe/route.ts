export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

// Disable automatic trailing slash redirect for this route
export const runtime = 'nodejs';
import { headers } from 'next/headers';
import { getStripe } from '@/lib/stripe';
import {
  findProfileForStripeCustomer,
  reconcileUserSubscription,
} from '@/lib/stripeCustomer';
import {
  activateReferralForSubscription,
  endReferral,
  markSubscriptionEnded,
  maybeExpirePastDueReferral,
  reconcileUserReferralDiscount,
  recordPendingReferral,
} from '@/lib/referral/reconcile';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Validate required environment variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is required');
}
if (!supabaseServiceKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

// Create Supabase admin client (bypasses RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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

function isPushoverConfigured(): boolean {
  return Boolean(process.env.PUSHOVER_TOKEN && process.env.PUSHOVER_USER_KEY);
}

async function sendPushoverNotification(title: string, message: string): Promise<void> {
  const token = process.env.PUSHOVER_TOKEN;
  const user = process.env.PUSHOVER_USER_KEY;
  if (!token || !user) return;

  const body = new URLSearchParams();
  body.set('token', token);
  body.set('user', user);
  body.set('title', title);
  body.set('message', message);
  body.set('priority', '0');

  const response = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pushover API ${response.status}: ${errorText.slice(0, 300)}`);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'No signature' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');
    }
    
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      webhookSecret
    );
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  try {
    console.log(`🔔 Webhook received: ${event.type}`);
    
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log('📦 Checkout session completed:', {
          sessionId: session.id,
          customer: session.customer,
          subscription: session.subscription,
          metadata: session.metadata
        });
        await handleCheckoutCompleted(session);
        break;
      }

      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('✨ Subscription created:', {
          subscriptionId: subscription.id,
          customer: subscription.customer,
          status: subscription.status
        });
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('🔄 Subscription updated:', {
          subscriptionId: subscription.id,
          customer: subscription.customer,
          status: subscription.status
        });
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log('🗑️ Subscription deleted:', {
          subscriptionId: subscription.id,
          customer: subscription.customer
        });
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentSucceeded(invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(invoice);
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object as Stripe.Charge;
        await handleChargeRefunded(charge);
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        await handleDispute(dispute);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Webhook handler error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.user_id;
  const billingCycle = session.metadata?.billing_cycle;
  const hasTrial = session.metadata?.has_trial === 'true';
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const checkoutEmail = session.customer_details?.email ?? null;

  console.log('💳 Processing checkout:', { userId, billingCycle, customerId, subscriptionId: session.subscription, hasTrial });

  if (!userId) {
    console.error('❌ No user_id in session metadata');
    return;
  }

  // Get subscription details
  if (!session.subscription) {
    console.error('❌ No subscription in session');
    return;
  }

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
  
  console.log('📋 Subscription ID:', subscriptionId);

  // If this subscription has a trial, mark trial as used
  const updateData: any = {
    subscription_status: 'active', // Will be updated by subscription.created webhook
    subscription_tier: 'pro',
    subscription_billing_cycle: billingCycle,
    stripe_subscription_id: subscriptionId,
    stripe_customer_id: customerId,
    subscription_current_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now (trial period)
  };

  if (hasTrial) {
    updateData.has_used_trial = true;
    updateData.trial_used_at = new Date().toISOString();
    
    // Get user email and send trial start email
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single();
    
    if (profile?.email) {
      // Get subscription details to send trial email
      const stripe = getStripe();
      try {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        if (subscription.status === 'trialing') {
          await sendTrialStartEmail(profile.email, subscription);
        }
      } catch (error) {
        console.error('Error fetching subscription for trial email:', error);
      }
    }
  }

  // Update user profile with subscription info
  // Note: subscription.created webhook will handle setting the exact status
  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updateData)
    .eq('id', userId);

  if (error) {
    console.error('❌ Error updating profile:', error);
  } else {
    console.log('✅ Profile updated successfully for user:', userId);
  }

  // Reconcile so any older duplicate customers/subs cannot leave the profile on a worse state.
  try {
    const stripe = getStripe();
    await reconcileUserSubscription(
      supabaseAdmin,
      {
        userId,
        email: checkoutEmail,
        knownCustomerId: customerId,
      },
      { stripe, cancelDuplicates: true, persist: true }
    );
  } catch (reconcileError) {
    console.error('⚠️ Checkout completed but reconcile failed:', reconcileError);
  }

  // Referral attribution (pending until first paid invoice activates).
  try {
    const referrerUserId = session.metadata?.referrer_user_id;
    const referralCode = session.metadata?.referral_code;
    if (referrerUserId && referralCode && userId) {
      await recordPendingReferral(supabaseAdmin, {
        referrerUserId,
        referredUserId: userId,
        referralCode,
        stripeSubscriptionId: subscriptionId,
      });
    }
  } catch (referralErr) {
    console.error('⚠️ Checkout referral attribution failed:', referralErr);
  }

  // Fire-and-forget signup push notification (never block or fail webhook flow)
  if (isPushoverConfigured()) {
    try {
      const billingLabel =
        billingCycle === 'annual'
          ? 'Annual'
          : billingCycle === 'semiannual'
            ? '6 Months'
            : billingCycle === 'monthly'
              ? 'Monthly'
              : (billingCycle || 'Unknown');
      const trialLabel = hasTrial ? 'Yes' : 'No';
      const emailLabel = checkoutEmail || 'No email in checkout';
      const message = `New signup\nEmail: ${emailLabel}\nBilling: ${billingLabel}\nTrial: ${trialLabel}\nUser: ${userId}`;
      await sendPushoverNotification('StatTrackr: New Signup', message);
      console.log('✅ Pushover signup notification sent');
    } catch (notifyError) {
      console.error('⚠️ Failed to send Pushover signup notification:', notifyError);
    }
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const stripe = getStripe();

  // Resolve profile even when stripe_customer_id on the profile points elsewhere.
  const profile = await findProfileForStripeCustomer(supabaseAdmin, stripe, customerId);

  if (!profile) {
    console.error('No user found for customer:', customerId);
    return;
  }

  const hasTrial = subscription.trial_start !== null && subscription.trial_end !== null;
  const isNewTrial = hasTrial && !profile.has_used_trial && subscription.status === 'trialing';

  // Business rule: when a free trial is canceled, remove access immediately.
  // Paid subscriptions still keep access until period end via Stripe's normal flow.
  const cutoffMs = getTrialImmediateCancelCutoffMs();
  const trialUsedAtMs = profile.trial_used_at ? Date.parse(profile.trial_used_at) : NaN;
  const trialStartMs = Number.isNaN(trialUsedAtMs) ? subscription.created * 1000 : trialUsedAtMs;
  const isNewTrialForImmediateCancel = cutoffMs === null || trialStartMs >= cutoffMs;
  const isCanceledFreeTrial =
    subscription.status === 'trialing' &&
    subscription.cancel_at_period_end === true &&
    isNewTrialForImmediateCancel;

  if (isCanceledFreeTrial) {
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        subscription_status: 'canceled',
        subscription_tier: 'free',
        subscription_current_period_end: new Date().toISOString(),
        stripe_subscription_id: subscription.id,
        stripe_customer_id: customerId,
        ...(hasTrial && !profile.has_used_trial
          ? { has_used_trial: true, trial_used_at: new Date().toISOString() }
          : {}),
      })
      .eq('id', profile.id);

    if (error) {
      console.error('Error updating canceled trial:', error);
    } else {
      console.log(
        `Trial canceled immediately for user ${profile.id}: subscription=${subscription.id}`
      );
    }
    return;
  }

  // Always reconcile across ALL customers for this user so a past_due duplicate
  // cannot overwrite an active subscription on another customer.
  try {
    const reconciled = await reconcileUserSubscription(
      supabaseAdmin,
      {
        userId: profile.id,
        email: profile.email,
        knownCustomerId: profile.stripe_customer_id || customerId,
      },
      {
        stripe,
        cancelDuplicates: true,
        persist: true,
      }
    );

    if (hasTrial && !profile.has_used_trial) {
      await supabaseAdmin
        .from('profiles')
        .update({
          has_used_trial: true,
          trial_used_at: new Date().toISOString(),
        })
        .eq('id', profile.id);
      console.log(`🎁 Marking trial as used for user ${profile.id}`);
      if (isNewTrial) {
        await sendTrialStartEmail(profile.email, subscription);
      }
    }

    console.log(
      `Subscription reconciled for user ${profile.id}: status=${reconciled.profileUpdates.subscription_status}, tier=${reconciled.profileUpdates.subscription_tier}, kept=${reconciled.subscription?.id}, canceledDuplicates=${reconciled.canceledDuplicateIds.length}`
    );

    // Referral: paused / canceled period-end / past_due grace
    try {
      if (subscription.status === 'paused') {
        await endReferral(supabaseAdmin, stripe, {
          stripeSubscriptionId: subscription.id,
          reason: 'paused',
        });
      } else if (subscription.status === 'past_due') {
        await maybeExpirePastDueReferral(supabaseAdmin, stripe, subscription);
      } else if (
        reconciled.entitling &&
        !subscription.cancel_at_period_end &&
        !subscription.cancel_at
      ) {
        await reconcileUserReferralDiscount(supabaseAdmin, stripe, profile.id, {
          reason: 'subscription_updated',
        });
      }
    } catch (referralErr) {
      console.error('Referral subscription.updated hook failed:', referralErr);
    }
  } catch (error) {
    console.error('Error reconciling subscription:', error);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const stripe = getStripe();

  const profile = await findProfileForStripeCustomer(supabaseAdmin, stripe, customerId);

  if (!profile) {
    console.error('No user found for customer:', customerId);
    return;
  }

  // Reconcile instead of blindly clearing — another customer may still be entitling.
  try {
    const reconciled = await reconcileUserSubscription(
      supabaseAdmin,
      {
        userId: profile.id,
        email: profile.email,
        knownCustomerId: profile.stripe_customer_id || customerId,
      },
      {
        stripe,
        cancelDuplicates: true,
        persist: true,
      }
    );
    console.log(
      `Subscription deleted reconciled for user ${profile.id}: entitling=${reconciled.entitling}, status=${reconciled.profileUpdates.subscription_status}`
    );

    try {
      await endReferral(supabaseAdmin, stripe, {
        stripeSubscriptionId: subscription.id,
        reason: 'subscription_deleted',
      });
      if (!reconciled.entitling) {
        await markSubscriptionEnded(supabaseAdmin, profile.id);
      }
    } catch (referralErr) {
      console.error('Referral subscription.deleted hook failed:', referralErr);
    }
  } catch (error) {
    console.error('Error canceling subscription:', error);
  }
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  console.log('Invoice payment succeeded:', invoice.id);
  const stripe = getStripe();
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
  const subscriptionId =
    typeof (invoice as any).subscription === 'string'
      ? (invoice as any).subscription
      : (invoice as any).subscription?.id;

  if (!customerId) return;

  const profile = await findProfileForStripeCustomer(supabaseAdmin, stripe, customerId);
  if (!profile?.id) return;

  // Apply deferred tier decreases at renewal (subscription_cycle invoices).
  const billingReason = (invoice as any).billing_reason as string | undefined;
  if (billingReason === 'subscription_cycle') {
    try {
      await reconcileUserReferralDiscount(supabaseAdmin, stripe, profile.id, {
        forceApplyPending: true,
        reason: 'renewal',
      });
    } catch (err) {
      console.error('Referral renew reconcile failed:', err);
    }
  }

  if (!subscriptionId) return;

  // Activate referral on first successful payment for this subscription.
  try {
    let cardFingerprint: string | null = null;
    const paymentIntentId =
      typeof (invoice as any).payment_intent === 'string'
        ? (invoice as any).payment_intent
        : (invoice as any).payment_intent?.id;
    if (paymentIntentId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: ['payment_method'],
        });
        const pm = pi.payment_method;
        if (pm && typeof pm !== 'string' && pm.card?.fingerprint) {
          cardFingerprint = pm.card.fingerprint;
        }
      } catch {
        /* ignore */
      }
    }

    // Self-referral via card fingerprint vs referrer cards (best-effort).
    const { data: referral } = await supabaseAdmin
      .from('referrals')
      .select('id, referrer_user_id, status')
      .eq('referred_user_id', profile.id)
      .maybeSingle();

    if (referral && referral.status === 'pending' && cardFingerprint) {
      const { data: referrerProfile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', referral.referrer_user_id)
        .maybeSingle();
      if (referrerProfile?.stripe_customer_id) {
        try {
          const pms = await stripe.paymentMethods.list({
            customer: referrerProfile.stripe_customer_id,
            type: 'card',
            limit: 20,
          });
          const match = pms.data.some((p) => p.card?.fingerprint === cardFingerprint);
          if (match) {
            await supabaseAdmin
              .from('referrals')
              .update({
                status: 'disqualified',
                end_reason: 'same_card_fingerprint',
                ended_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq('id', referral.id);
            console.warn(`[referral] disqualified ${referral.id}: same card fingerprint`);
            return;
          }
        } catch {
          /* ignore */
        }
      }
    }

    await activateReferralForSubscription(supabaseAdmin, stripe, {
      referredUserId: profile.id,
      stripeSubscriptionId: subscriptionId,
      cardFingerprint,
    });
  } catch (err) {
    console.error('Referral activate failed:', err);
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;
  const stripe = getStripe();

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, stripe_subscription_id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (profile) {
    console.log('Payment failed for user:', profile.id);
    try {
      if (profile.stripe_subscription_id) {
        const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
        await maybeExpirePastDueReferral(supabaseAdmin, stripe, sub);
      }
    } catch (err) {
      console.error('past_due referral check failed:', err);
    }
  }
}

function invoiceIdFromCharge(charge: Stripe.Charge | Record<string, unknown>): string | null {
  const inv = (charge as any).invoice;
  if (typeof inv === 'string') return inv;
  if (inv && typeof inv === 'object' && typeof inv.id === 'string') return inv.id;
  return null;
}

async function handleChargeRefunded(charge: Stripe.Charge) {
  const stripe = getStripe();
  const invoiceId = invoiceIdFromCharge(charge);
  if (!invoiceId) return;
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const subscriptionId =
      typeof (invoice as any).subscription === 'string'
        ? (invoice as any).subscription
        : (invoice as any).subscription?.id;
    if (!subscriptionId) return;
    await endReferral(supabaseAdmin, stripe, {
      stripeSubscriptionId: subscriptionId,
      reason: 'refund',
    });
  } catch (err) {
    console.error('Refund referral end failed:', err);
  }
}

async function handleDispute(dispute: Stripe.Dispute) {
  const stripe = getStripe();
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;
  try {
    const charge = await stripe.charges.retrieve(chargeId);
    const invoiceId = invoiceIdFromCharge(charge as any);
    if (!invoiceId) return;
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const subscriptionId =
      typeof (invoice as any).subscription === 'string'
        ? (invoice as any).subscription
        : (invoice as any).subscription?.id;
    if (!subscriptionId) return;
    await endReferral(supabaseAdmin, stripe, {
      stripeSubscriptionId: subscriptionId,
      reason: 'dispute',
    });
  } catch (err) {
    console.error('Dispute referral end failed:', err);
  }
}

/**
 * Send email when free trial starts
 */
async function sendTrialStartEmail(userEmail: string | null, subscription: Stripe.Subscription) {
  if (!userEmail) {
    console.warn('No email address for trial start notification');
    return;
  }

  try {
    const stripe = getStripe();
    
    // Get customer details to ensure we have the email
    const customer = await stripe.customers.retrieve(subscription.customer as string);
    const customerEmail = (customer && !('deleted' in customer) && customer.email) ? customer.email : userEmail;
    
    // Calculate trial end date
    const trialEndDate = subscription.trial_end 
      ? new Date(subscription.trial_end * 1000).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      : '7 days from now';

    // TODO: Replace with your email service (Resend, SendGrid, etc.)
    // For now, we'll use Stripe's built-in email or log it
    
    // Option 1: Use Stripe to send email (requires Stripe email template setup)
    // You can configure this in Stripe Dashboard → Settings → Email delivery
    
    // Option 2: Use your own email service (Resend, SendGrid, etc.)
    // Example with Resend:
    /*
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (RESEND_API_KEY) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'StatTrackr <noreply@stattrackr.com>',
          to: [customerEmail],
          subject: '🎉 Your 7-Day Free Trial Has Started!',
          html: `
            <h1>Welcome to StatTrackr Pro!</h1>
            <p>Your 7-day free trial has started. Enjoy full access to all Pro features.</p>
            <p><strong>Trial ends:</strong> ${trialEndDate}</p>
            <p>No credit card will be charged until your trial ends.</p>
            <p>Get started: <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://stattrackr.com'}/nba/research/dashboard">Go to Dashboard</a></p>
          `,
        }),
      });
      
      if (response.ok) {
        console.log(`✅ Trial start email sent to ${customerEmail}`);
      } else {
        console.error('Failed to send trial start email:', await response.text());
      }
    }
    */
    
    // For now, just log it (you can add email service later)
    console.log(`📧 Trial start email should be sent to: ${customerEmail}`);
    console.log(`   Trial ends: ${trialEndDate}`);
    console.log(`   Subscription ID: ${subscription.id}`);
    
    // Note: Stripe automatically sends some trial-related emails if configured
    // Check: https://dashboard.stripe.com/settings/billing/automatic
    
  } catch (error: any) {
    console.error('Error sending trial start email:', error);
    // Don't throw - email failure shouldn't break the webhook
  }
}
