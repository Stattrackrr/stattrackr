/**
 * One-off repair: reconcile a user across all Stripe customers.
 * Usage: node scripts/repair-user-subscription.js <email>
 */
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/repair-user-subscription.js <email>');
  process.exit(1);
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-10-29.clover' });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ENTITLING = new Set(['active', 'trialing']);
const CANCEL = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']);
const RANK = {
  active: 100,
  trialing: 90,
  past_due: 50,
  unpaid: 40,
  incomplete: 30,
  paused: 20,
  canceled: 10,
};

async function main() {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !profile) {
    throw error || new Error('Profile not found');
  }

  console.log('Before:', {
    customer: profile.stripe_customer_id,
    sub: profile.stripe_subscription_id,
    status: profile.subscription_status,
    tier: profile.subscription_tier,
  });

  const byId = new Map();

  if (profile.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(profile.stripe_customer_id);
      if (!customer.deleted) byId.set(customer.id, customer);
    } catch (_) {
      // ignore missing
    }
  }

  const listed = await stripe.customers.list({ email, limit: 100 });
  for (const customer of listed.data) byId.set(customer.id, customer);

  try {
    const searched = await stripe.customers.search({
      query: `metadata['supabase_user_id']:'${profile.id}'`,
      limit: 100,
    });
    for (const customer of searched.data) byId.set(customer.id, customer);
  } catch (searchError) {
    console.warn('Customer search skipped:', searchError.message);
  }

  const entries = [];
  for (const customer of byId.values()) {
    const subs = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 100,
    });
    for (const subscription of subs.data) {
      entries.push({ subscription, customerId: customer.id });
    }
  }

  entries.sort(
    (a, b) =>
      (RANK[b.subscription.status] || 0) - (RANK[a.subscription.status] || 0) ||
      b.subscription.created - a.subscription.created
  );

  const best = entries[0];
  if (!best) {
    throw new Error('No subscriptions found for user');
  }

  console.log('Best:', {
    id: best.subscription.id,
    status: best.subscription.status,
    customer: best.customerId,
  });

  const canceled = [];
  if (ENTITLING.has(best.subscription.status)) {
    for (const entry of entries) {
      if (entry.subscription.id === best.subscription.id) continue;
      if (!CANCEL.has(entry.subscription.status)) continue;
      await stripe.subscriptions.cancel(entry.subscription.id, {
        prorate: false,
        invoice_now: false,
      });
      canceled.push(entry.subscription.id);
      console.log('Canceled duplicate', entry.subscription.id, entry.subscription.status);
    }
  }

  const periodEnd = best.subscription.current_period_end;
  const updates = {
    stripe_customer_id: best.customerId,
    stripe_subscription_id: best.subscription.id,
    subscription_status: best.subscription.status,
    subscription_tier: ENTITLING.has(best.subscription.status) ? 'pro' : 'free',
    subscription_billing_cycle: 'monthly',
    subscription_current_period_end: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : null,
    has_used_trial: true,
  };

  const { error: updateError } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', profile.id);

  if (updateError) throw updateError;

  const { data: after } = await supabase
    .from('profiles')
    .select(
      'stripe_customer_id, stripe_subscription_id, subscription_status, subscription_tier'
    )
    .eq('id', profile.id)
    .single();

  console.log('After:', after);
  console.log('Canceled:', canceled);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
