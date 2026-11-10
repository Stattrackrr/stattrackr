import {
  REFERRAL_FRIEND_PERCENT,
  REFERRAL_MAX_PERCENT,
  type ReferralCouponPercent,
} from './constants';

/** Referrer tier from number of currently active referred friends. */
export function referrerTierPercent(activeFriendCount: number): ReferralCouponPercent {
  if (activeFriendCount >= 3) return 35;
  if (activeFriendCount === 2) return 30;
  if (activeFriendCount === 1) return 20;
  return 0;
}

/**
 * One coupon only: max(friend 20%, referrer tier), capped at 35%.
 * Friend discount alone is always 20% until/unless their own referrer tier exceeds it.
 */
export function effectiveReferralPercent(opts: {
  isReferredFriend: boolean;
  activeFriendCountAsReferrer: number;
}): ReferralCouponPercent {
  const friendPct: ReferralCouponPercent = opts.isReferredFriend ? REFERRAL_FRIEND_PERCENT : 0;
  const tierPct = referrerTierPercent(opts.activeFriendCountAsReferrer);
  const raw = Math.max(friendPct, tierPct);
  if (raw >= REFERRAL_MAX_PERCENT) return 35;
  if (raw >= 30) return 30;
  if (raw >= 20) return 20;
  return 0;
}

export function nextTierInfo(activeFriendCount: number): {
  nextCount: number | null;
  nextPercent: ReferralCouponPercent | null;
} {
  if (activeFriendCount <= 0) return { nextCount: 1, nextPercent: 20 };
  if (activeFriendCount === 1) return { nextCount: 2, nextPercent: 30 };
  if (activeFriendCount === 2) return { nextCount: 3, nextPercent: 35 };
  return { nextCount: null, nextPercent: null };
}
