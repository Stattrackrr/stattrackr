import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

/** Statuses that grant Pro access in the app. */
export const ENTITLING_STATUSES = new Set(['active', 'trialing']);

/** Subscriptions that should be canceled when a better entitling sub already exists. */
const DUPLICATE_CANCEL_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
  'incomplete',
  'paused',
]);

const STATUS_RANK: Record<string, number> = {
  active: 100,
  trialing: 90,
  past_due: 50,
  unpaid: 40,
  incomplete: 30,
  paused: 20,
  canceled: 10,
  incomplete_expired: 5,
};

export type UserStripeIdentity = {
  userId: string;
  email?: string | null;
  knownCustomerId?: string | null;
};

export type SubscriptionWithCustomer = {
  subscription: Stripe.Subscription;
  customerId: string;
};

export function isEntitlingStatus(status: string | null | undefined): boolean {
  return Boolean(status && ENTITLING_STATUSES.has(status));
}

export function billingCycleFromSubscription(subscription: Stripe.Subscription): string {
  const priceId = subscription.items.data[0]?.price?.id || '';
  if (priceId.includes('annual')) return 'annual';
  if (priceId.includes('semiannual')) return 'semiannual';
  return 'monthly';
}

export function pickBestSubscription(
  entries: SubscriptionWithCustomer[]
): SubscriptionWithCustomer | null {
  if (entries.length === 0) return null;

  return [...entries].sort((a, b) => {
    const rankDiff =
      (STATUS_RANK[b.subscription.status] ?? 0) - (STATUS_RANK[a.subscription.status] ?? 0);
    if (rankDiff !== 0) return rankDiff;
    return b.subscription.created - a.subscription.created;
  })[0];
}

function isUsableCustomer(
  customer: Stripe.Customer | Stripe.DeletedCustomer
): customer is Stripe.Customer {
  return Boolean(customer && !('deleted' in customer && customer.deleted));
}

/**
 * Collect every Stripe customer that belongs to this app user.
 * Prefers known ID, then email matches, then metadata.supabase_user_id search.
 */
export async function listCustomersForUser(
  stripe: Stripe,
  identity: UserStripeIdentity
): Promise<Stripe.Customer[]> {
  const byId = new Map<string, Stripe.Customer>();

  if (identity.knownCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(identity.knownCustomerId);
      if (isUsableCustomer(customer)) {
        byId.set(customer.id, customer);
      }
    } catch (error: any) {
      if (error?.code !== 'resource_missing') {
        console.warn('[stripeCustomer] Failed to retrieve known customer:', error?.message || error);
      }
    }
  }

  if (identity.email) {
    const listed = await stripe.customers.list({
      email: identity.email,
      limit: 100,
    });
    for (const customer of listed.data) {
      byId.set(customer.id, customer);
    }
  }

  try {
    const searched = await stripe.customers.search({
      query: `metadata['supabase_user_id']:'${identity.userId}'`,
      limit: 100,
    });
    for (const customer of searched.data) {
      byId.set(customer.id, customer);
    }
  } catch (error: any) {
    // Search API may be unavailable in some Stripe setups; email/known ID still work.
    console.warn('[stripeCustomer] Customer search unavailable:', error?.message || error);
  }

  return Array.from(byId.values());
}

export async function listSubscriptionsForCustomers(
  stripe: Stripe,
  customerIds: string[]
): Promise<SubscriptionWithCustomer[]> {
  const entries: SubscriptionWithCustomer[] = [];

  for (const customerId of customerIds) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
    });
    for (const subscription of subscriptions.data) {
      entries.push({ subscription, customerId });
    }
  }

  return entries;
}

export function profileUpdatesFromBestSubscription(
  best: SubscriptionWithCustomer | null,
  options?: { preserveCustomerId?: string | null }
): Record<string, unknown> {
  if (!best) {
    return {
      stripe_customer_id: options?.preserveCustomerId ?? null,
      stripe_subscription_id: null,
      subscription_status: 'canceled',
      subscription_tier: 'free',
      subscription_billing_cycle: null,
      subscription_current_period_end: null,
    };
  }

  const { subscription, customerId } = best;
  const periodEnd = (subscription as any).current_period_end as number | null | undefined;
  const entitling = isEntitlingStatus(subscription.status);

  return {
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    subscription_tier: entitling ? 'pro' : 'free',
    subscription_billing_cycle: billingCycleFromSubscription(subscription),
    subscription_current_period_end: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : null,
  };
}

export function hasTrialHistory(entries: SubscriptionWithCustomer[]): boolean {
  return entries.some(
    ({ subscription }) => subscription.trial_start !== null && subscription.trial_end !== null
  );
}

/**
 * Reuse an existing Stripe customer for this user, or create one with a stable idempotency key
 * so concurrent checkout requests cannot create duplicates.
 */
export async function resolveOrCreateStripeCustomer(
  stripe: Stripe,
  supabase: SupabaseClient,
  identity: UserStripeIdentity
): Promise<{ customerId: string; created: boolean; customers: Stripe.Customer[] }> {
  const customers = await listCustomersForUser(stripe, identity);
  const subscriptions = customers.length
    ? await listSubscriptionsForCustomers(
        stripe,
        customers.map((customer) => customer.id)
      )
    : [];
  const best = pickBestSubscription(subscriptions);

  let customerId =
    best?.customerId ||
    identity.knownCustomerId ||
    customers[0]?.id ||
    null;
  let created = false;

  if (customerId) {
    // Prefer a still-valid known/best customer; drop missing ones and fall through to create.
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (!isUsableCustomer(customer)) {
        customerId = null;
      }
    } catch (error: any) {
      if (error?.code === 'resource_missing') {
        customerId = null;
      } else {
        throw error;
      }
    }
  }

  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        email: identity.email || undefined,
        metadata: {
          supabase_user_id: identity.userId,
        },
      },
      {
        idempotencyKey: `stattrackr_customer_${identity.userId}`,
      }
    );
    customerId = customer.id;
    created = true;
    customers.push(customer);
  }

  if (customerId !== identity.knownCustomerId) {
    const { error } = await supabase
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', identity.userId);
    if (error) {
      console.error('[stripeCustomer] Failed to persist stripe_customer_id:', error);
    }
  }

  return { customerId, created, customers };
}

/**
 * Cancel non-primary subscriptions so a user cannot keep paying (or retrying) on duplicates.
 */
export async function cancelDuplicateSubscriptions(
  stripe: Stripe,
  entries: SubscriptionWithCustomer[],
  keepSubscriptionId: string | null
): Promise<string[]> {
  const canceledIds: string[] = [];

  for (const { subscription } of entries) {
    if (subscription.id === keepSubscriptionId) continue;
    if (!DUPLICATE_CANCEL_STATUSES.has(subscription.status)) continue;

    try {
      await stripe.subscriptions.cancel(subscription.id);
      canceledIds.push(subscription.id);
      console.log(
        `[stripeCustomer] Canceled duplicate subscription ${subscription.id} (kept ${keepSubscriptionId})`
      );
    } catch (error: any) {
      console.error(
        `[stripeCustomer] Failed to cancel duplicate ${subscription.id}:`,
        error?.message || error
      );
    }
  }

  return canceledIds;
}

export type ReconcileResult = {
  customerId: string | null;
  subscription: Stripe.Subscription | null;
  entitling: boolean;
  canceledDuplicateIds: string[];
  profileUpdates: Record<string, unknown>;
};

/**
 * Source-of-truth reconcile: inspect every customer for the user, point the profile at the
 * best subscription, and optionally cancel duplicate billable subscriptions.
 */
export async function reconcileUserSubscription(
  supabase: SupabaseClient,
  identity: UserStripeIdentity,
  options?: {
    stripe?: Stripe;
    cancelDuplicates?: boolean;
    persist?: boolean;
  }
): Promise<ReconcileResult> {
  const stripe = options?.stripe ?? getStripe();
  const cancelDuplicates = options?.cancelDuplicates ?? true;
  const persist = options?.persist ?? true;

  const customers = await listCustomersForUser(stripe, identity);
  const customerIds = customers.map((customer) => customer.id);
  const entries = customerIds.length
    ? await listSubscriptionsForCustomers(stripe, customerIds)
    : [];

  const best = pickBestSubscription(entries);
  const keepSubscriptionId = best?.subscription.id ?? null;
  let canceledDuplicateIds: string[] = [];

  if (cancelDuplicates && keepSubscriptionId && isEntitlingStatus(best?.subscription.status)) {
    canceledDuplicateIds = await cancelDuplicateSubscriptions(stripe, entries, keepSubscriptionId);
  }

  const primaryCustomerId =
    best?.customerId || identity.knownCustomerId || customers[0]?.id || null;

  const profileUpdates = profileUpdatesFromBestSubscription(best, {
    preserveCustomerId: primaryCustomerId,
  });

  // If we only have customers and no subs, still pin a stable customer id.
  if (!best && primaryCustomerId) {
    profileUpdates.stripe_customer_id = primaryCustomerId;
    profileUpdates.subscription_status = null;
    profileUpdates.subscription_tier = 'free';
  }

  if (hasTrialHistory(entries)) {
    profileUpdates.has_used_trial = true;
  }

  if (persist) {
    const { error } = await supabase
      .from('profiles')
      .update(profileUpdates)
      .eq('id', identity.userId);
    if (error) {
      throw error;
    }
  }

  return {
    customerId: (profileUpdates.stripe_customer_id as string | null) ?? null,
    subscription: best?.subscription ?? null,
    entitling: isEntitlingStatus(best?.subscription.status),
    canceledDuplicateIds,
    profileUpdates,
  };
}

/**
 * Resolve which Supabase profile a Stripe customer belongs to.
 * Falls back through customer id → metadata → email so orphaned customers still sync.
 */
export async function findProfileForStripeCustomer(
  supabase: SupabaseClient,
  stripe: Stripe,
  customerId: string
): Promise<{ id: string; email: string | null; has_used_trial: boolean | null; trial_used_at: string | null; stripe_customer_id: string | null; stripe_subscription_id: string | null } | null> {
  const { data: byCustomer } = await supabase
    .from('profiles')
    .select('id, email, has_used_trial, trial_used_at, stripe_customer_id, stripe_subscription_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (byCustomer) return byCustomer;

  let customer: Stripe.Customer | Stripe.DeletedCustomer | null = null;
  try {
    customer = await stripe.customers.retrieve(customerId);
  } catch (error: any) {
    console.error('[stripeCustomer] Could not retrieve customer for profile lookup:', error?.message || error);
    return null;
  }

  if (!isUsableCustomer(customer)) return null;

  const supabaseUserId = customer.metadata?.supabase_user_id;
  if (supabaseUserId) {
    const { data: byMeta } = await supabase
      .from('profiles')
      .select('id, email, has_used_trial, trial_used_at, stripe_customer_id, stripe_subscription_id')
      .eq('id', supabaseUserId)
      .maybeSingle();
    if (byMeta) return byMeta;
  }

  if (customer.email) {
    const { data: byEmail } = await supabase
      .from('profiles')
      .select('id, email, has_used_trial, trial_used_at, stripe_customer_id, stripe_subscription_id')
      .eq('email', customer.email)
      .maybeSingle();
    if (byEmail) return byEmail;
  }

  return null;
}
