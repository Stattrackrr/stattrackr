import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EARLY_BIRD_BEFORE, MAX_DISPLAYED_BADGES } from './catalog';
import {
  defaultDisplayedBadgeIds,
  earnedBadgeIds,
  evaluateBadges,
  resolveDisplayedBadgeIds,
  sanitizeDisplayedBadgeIds,
} from './evaluate';

const NOW = Date.parse('2026-11-11T00:00:00.000Z');

test('new free user under 14 days', () => {
  const ids = earnedBadgeIds({
    createdAt: '2026-11-05T00:00:00.000Z',
    subscriptionStatus: null,
    subscriptionTier: null,
    referredByUserId: null,
    activeReferralCount: 0,
    nowMs: NOW,
  });
  assert.ok(ids.includes('new_user'));
  assert.ok(ids.includes('free'));
  assert.ok(!ids.includes('pro'));
  assert.ok(!ids.includes('member_1m'));
});

test('pro member is not free', () => {
  const ids = earnedBadgeIds({
    createdAt: '2026-01-01T00:00:00.000Z',
    subscriptionStatus: 'active',
    subscriptionTier: 'pro',
    referredByUserId: null,
    activeReferralCount: 0,
    nowMs: NOW,
  });
  assert.ok(ids.includes('pro'));
  assert.ok(!ids.includes('free'));
  assert.ok(!ids.includes('new_user'));
});

test('3 month tenure unlocks 1m and 3m', () => {
  const ids = earnedBadgeIds({
    createdAt: '2026-07-01T00:00:00.000Z',
    subscriptionStatus: 'active',
    subscriptionTier: 'pro',
    referredByUserId: null,
    activeReferralCount: 0,
    nowMs: NOW,
  });
  assert.ok(ids.includes('member_1m'));
  assert.ok(ids.includes('member_3m'));
  assert.ok(!ids.includes('member_6m'));
});

test('referred and connector', () => {
  const ids = earnedBadgeIds({
    createdAt: '2026-08-01T00:00:00.000Z',
    subscriptionStatus: null,
    subscriptionTier: null,
    referredByUserId: 'mate-1',
    activeReferralCount: 2,
    nowMs: NOW,
  });
  assert.ok(ids.includes('referred'));
  assert.ok(ids.includes('connector'));
});

test('early bird before cutoff', () => {
  const ids = earnedBadgeIds({
    createdAt: '2026-05-01T00:00:00.000Z',
    subscriptionStatus: null,
    subscriptionTier: null,
    referredByUserId: null,
    activeReferralCount: 0,
    nowMs: NOW,
  });
  assert.ok(ids.includes('early_bird'));
  assert.ok(Date.parse('2026-05-01T00:00:00.000Z') < Date.parse(EARLY_BIRD_BEFORE));
});

test('usage stubs appear as coming soon, not earned; catalog sorted rarer first', () => {
  const list = evaluateBadges({
    createdAt: '2026-11-01T00:00:00.000Z',
    subscriptionStatus: null,
    subscriptionTier: null,
    referredByUserId: null,
    activeReferralCount: 0,
    nowMs: NOW,
  });
  const stubs = list.filter((b) => b.comingSoon);
  assert.equal(stubs.length, 3);
  assert.ok(stubs.every((b) => !b.earned && b.kind === 'usage'));
  // rarer first: early_bird (mythic) would lead if earned; free user → connector not earned
  assert.ok(list[0].rarity === 'mythic' || list[0].rarity === 'epic');
});

test('default displayed is max 2 rarest earned', () => {
  const list = evaluateBadges({
    createdAt: '2026-05-01T00:00:00.000Z',
    subscriptionStatus: 'active',
    subscriptionTier: 'pro',
    referredByUserId: 'mate-1',
    activeReferralCount: 1,
    nowMs: NOW,
  });
  const picked = defaultDisplayedBadgeIds(list);
  assert.ok(picked.length <= MAX_DISPLAYED_BADGES);
  assert.equal(picked[0], 'early_bird');
});

test('admin crown only when isAdmin', () => {
  const normal = evaluateBadges({
    createdAt: '2026-01-01T00:00:00.000Z',
    subscriptionStatus: 'active',
    subscriptionTier: 'pro',
    referredByUserId: null,
    activeReferralCount: 0,
    nowMs: NOW,
  });
  assert.ok(!normal.some((b) => b.id === 'admin'));

  const admin = evaluateBadges({
    createdAt: '2026-01-01T00:00:00.000Z',
    subscriptionStatus: 'active',
    subscriptionTier: 'pro',
    referredByUserId: null,
    activeReferralCount: 0,
    isAdmin: true,
    nowMs: NOW,
  });
  const crown = admin.find((b) => b.id === 'admin');
  assert.ok(crown?.earned);
  assert.equal(admin[0].id, 'admin');
});

test('resolveDisplayedBadgeIds: null auto, empty none, selection sanitized', () => {
  const list = evaluateBadges({
    createdAt: '2026-05-01T00:00:00.000Z',
    subscriptionStatus: 'active',
    subscriptionTier: 'pro',
    referredByUserId: null,
    activeReferralCount: 0,
    nowMs: NOW,
  });
  assert.deepEqual(resolveDisplayedBadgeIds(list, null).slice(0, 1), ['early_bird']);
  assert.deepEqual(resolveDisplayedBadgeIds(list, []), []);
  assert.deepEqual(resolveDisplayedBadgeIds(list, ['pro', 'free', 'pro']), ['pro']);
  assert.deepEqual(sanitizeDisplayedBadgeIds(list, ['pro', 'nope', 'early_bird', 'member_1m']), [
    'pro',
    'early_bird',
  ]);
});
