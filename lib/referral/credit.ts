import type Stripe from 'stripe';
import type { ReferralCouponPercent } from './constants';

/**
 * Credit for a tier INCREASE mid-cycle.
 * Stripe does not prorate coupon-only updates; we add customer balance credit
 * for (newPercent - oldPercent) of the remaining period, then swap the coupon
 * so the new % applies from next renewal.
 */
export function computeTierIncreaseCreditCents(opts: {
  periodStartSec: number;
  periodEndSec: number;
  nowSec?: number;
  /** Recurring invoice amount in cents before discounts (approx). */
  periodAmountCents: number;
  oldPercent: ReferralCouponPercent;
  newPercent: ReferralCouponPercent;
}): number {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const start = opts.periodStartSec;
  const end = opts.periodEndSec;
  if (!(end > start) || opts.newPercent <= opts.oldPercent) return 0;
  if (now >= end) return 0;

  const remainingRatio = Math.min(1, Math.max(0, (end - now) / (end - start)));
  const extraOffRatio = (opts.newPercent - opts.oldPercent) / 100;
  const credit = Math.round(opts.periodAmountCents * remainingRatio * extraOffRatio);
  return Math.max(0, credit);
}

export async function getSubscriptionPeriodAmountCents(
  stripe: Stripe,
  subscription: Stripe.Subscription
): Promise<number> {
  let total = 0;
  for (const item of subscription.items.data) {
    const price = item.price;
    if (price?.unit_amount != null) {
      total += price.unit_amount * (item.quantity || 1);
    }
  }
  if (total > 0) return total;

  // Fallback: upcoming invoice
  try {
    const upcoming = await stripe.invoices.createPreview({
      customer: subscription.customer as string,
      subscription: subscription.id,
    });
    return Math.max(0, upcoming.subtotal || upcoming.total || 0);
  } catch {
    return 0;
  }
}

export async function applyCustomerBalanceCredit(
  stripe: Stripe,
  customerId: string,
  amountCents: number,
  currency: string,
  description: string
): Promise<void> {
  if (amountCents <= 0) return;
  // Negative balance = credit owed to customer in Stripe.
  await stripe.customers.createBalanceTransaction(customerId, {
    amount: -Math.abs(amountCents),
    currency: currency || 'aud',
    description,
  });
}
