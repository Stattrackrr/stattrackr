export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

// Disable automatic trailing slash redirect for this route
export const runtime = 'nodejs';
import { headers } from 'next/headers';
import { getStripe } from '@/lib/stripe';
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
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

  console.log('💳 Processing checkout:', { userId, billingCycle, customerId, subscriptionId: session.subscription });

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

  // Update user profile with subscription info
  // Note: subscription.created webhook will handle setting the exact status
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: 'active', // Will be updated by subscription.created webhook
      subscription_tier: 'pro',
      subscription_billing_cycle: billingCycle,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: customerId,
      subscription_current_period_end: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now (trial period)
    })
    .eq('id', userId);

  if (error) {
    console.error('❌ Error updating profile:', error);
  } else {
    console.log('✅ Profile updated successfully for user:', userId);
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const subData = subscription as any;

  // Find user by customer ID
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) {
    console.error('No user found for customer:', customerId);
    return;
  }

  // Determine subscription tier based on status
  const tier = ['active', 'trialing'].includes(subscription.status) ? 'pro' : 'free';

  // Update subscription details
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: subscription.status,
      subscription_tier: tier,
      subscription_current_period_end: subData.current_period_end 
        ? new Date(subData.current_period_end * 1000).toISOString()
        : null,
      stripe_subscription_id: subscription.id,
    })
    .eq('id', profile.id);

  if (error) {
    console.error('Error updating subscription:', error);
  } else {
    console.log(`Subscription updated for user ${profile.id}: status=${subscription.status}, tier=${tier}`);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) {
    console.error('No user found for customer:', customerId);
    return;
  }

  // Mark subscription as canceled
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({
      subscription_status: 'canceled',
      subscription_tier: 'free',
      stripe_subscription_id: null,
    })
    .eq('id', profile.id);

  if (error) {
    console.error('Error canceling subscription:', error);
  }
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  // Optional: Log successful payment, send receipt email, etc.
  console.log('Invoice payment succeeded:', invoice.id);
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email')
    .eq('stripe_customer_id', customerId)
    .single();

  if (profile) {
    // Optional: Send payment failed notification
    console.log('Payment failed for user:', profile.id);
  }
}
