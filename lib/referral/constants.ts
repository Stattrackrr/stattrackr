/** Stripe forever %-off coupons for the referral program. Created by scripts/ensure-referral-coupons.ts */
export const REFERRAL_COUPON_IDS = {
  20: 'ref_20_forever',
  30: 'ref_30_forever',
  35: 'ref_35_forever',
} as const;

export type ReferralCouponPercent = 0 | 20 | 30 | 35;

export const REFERRAL_REJOIN_GAP_DAYS = 30;
export const REFERRAL_PAST_DUE_GRACE_DAYS = 14;
export const REFERRAL_MAX_PERCENT = 35;
export const REFERRAL_FRIEND_PERCENT = 20;

export const REFERRAL_COOKIE = 'st_ref';
export const REFERRAL_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

export function couponIdForPercent(percent: ReferralCouponPercent): string | null {
  if (percent === 0) return null;
  return REFERRAL_COUPON_IDS[percent];
}

export function isReferralCouponId(couponId: string | null | undefined): boolean {
  if (!couponId) return false;
  return Object.values(REFERRAL_COUPON_IDS).includes(couponId as (typeof REFERRAL_COUPON_IDS)[20]);
}
