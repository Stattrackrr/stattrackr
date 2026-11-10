/**
 * Create forever %-off Stripe coupons for the referral program.
 * Usage: npx tsx scripts/ensure-referral-coupons.ts
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';

loadEnv({ path: resolve(process.cwd(), '.env.local') });
loadEnv({ path: resolve(process.cwd(), '.env') });

import { getStripe } from '../lib/stripe';
import { REFERRAL_COUPON_IDS } from '../lib/referral/constants';

async function ensureCoupon(id: string, percent: number, name: string) {
  const stripe = getStripe();
  try {
    const existing = await stripe.coupons.retrieve(id);
    console.log(`✓ exists ${id} (${existing.percent_off}% off, duration=${existing.duration})`);
    return existing;
  } catch {
    const created = await stripe.coupons.create({
      id,
      percent_off: percent,
      duration: 'forever',
      name,
      metadata: { program: 'refer_a_friend' },
    });
    console.log(`+ created ${id} (${percent}% forever)`);
    return created;
  }
}

async function main() {
  await ensureCoupon(REFERRAL_COUPON_IDS[20], 20, 'Referral 20%');
  await ensureCoupon(REFERRAL_COUPON_IDS[30], 30, 'Referral 30%');
  await ensureCoupon(REFERRAL_COUPON_IDS[35], 35, 'Referral 35%');
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
