/**
 * Scan for profiles whose linked Stripe customer is not the best entitling
 * subscription for their email. Dry-run by default; pass --fix to repair.
 *
 * Usage:
 *   node scripts/scan-subscription-desync.js
 *   node scripts/scan-subscription-desync.js --fix
 */
require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

const shouldFix = process.argv.includes('--fix');
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

async function bestForEmail(email, knownCustomerId, userId) {
  const byId = new Map();

  if (knownCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(knownCustomerId);
      if (!customer.deleted) byId.set(customer.id, customer);
    } catch (_) {}
  }

  if (email) {
    const listed = await stripe.customers.list({ email, limit: 100 });
    for (const customer of listed.data) byId.set(customer.id, customer);
  }

  try {
    const searched = await stripe.customers.search({
      query: `metadata['supabase_user_id']:'${userId}'`,
      limit: 100,
    });
    for (const customer of searched.data) byId.set(customer.id, customer);
  } catch (_) {}

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

  return { entries, best: entries[0] || null, customerCount: byId.size };
}

async function main() {
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select(
      'id, email, stripe_customer_id, stripe_subscription_id, subscription_status, subscription_tier'
    )
    .not('email', 'is', null);

  if (error) throw error;

  const issues = [];

  for (const profile of profiles) {
    const { entries, best, customerCount } = await bestForEmail(
      profile.email,
      profile.stripe_customer_id,
      profile.id
    );

    if (!best) continue;

    const linkedWrong =
      profile.stripe_customer_id &&
      best.customerId !== profile.stripe_customer_id &&
      ENTITLING.has(best.subscription.status);

    const statusWrong =
      ENTITLING.has(best.subscription.status) &&
      !(
        ENTITLING.has(profile.subscription_status) &&
        profile.subscription_tier === 'pro' &&
        profile.stripe_subscription_id === best.subscription.id
      );

    const hasDuplicateBillable =
      ENTITLING.has(best.subscription.status) &&
      entries.filter(
        (entry) =>
          entry.subscription.id !== best.subscription.id &&
          CANCEL.has(entry.subscription.status)
      ).length > 0;

    if (linkedWrong || statusWrong || hasDuplicateBillable || customerCount > 1 && statusWrong) {
      if (!(linkedWrong || statusWrong || hasDuplicateBillable)) continue;

      issues.push({
        email: profile.email,
        profileStatus: profile.subscription_status,
        profileTier: profile.subscription_tier,
        profileCustomer: profile.stripe_customer_id,
        bestStatus: best.subscription.status,
        bestCustomer: best.customerId,
        bestSub: best.subscription.id,
        customers: customerCount,
        linkedWrong,
        statusWrong,
        hasDuplicateBillable,
      });

      if (shouldFix) {
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
          }
        }

        const periodEnd = best.subscription.current_period_end;
        await supabase
          .from('profiles')
          .update({
            stripe_customer_id: best.customerId,
            stripe_subscription_id: best.subscription.id,
            subscription_status: best.subscription.status,
            subscription_tier: ENTITLING.has(best.subscription.status) ? 'pro' : 'free',
            subscription_current_period_end: periodEnd
              ? new Date(periodEnd * 1000).toISOString()
              : null,
          })
          .eq('id', profile.id);

        console.log('Fixed', profile.email, 'canceled', canceled);
      }
    }
  }

  console.log(`Found ${issues.length} issue(s)${shouldFix ? ' (repaired)' : ' (dry-run)'}`);
  console.log(JSON.stringify(issues, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
