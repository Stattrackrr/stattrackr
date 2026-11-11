/**
 * Pure badge evaluation from profile + referral counts. No I/O.
 */

import {
  BADGE_CATALOG,
  EARLY_BIRD_BEFORE,
  MAX_DISPLAYED_BADGES,
  NEW_USER_DAYS,
  badgeById,
  compareBadgeRarity,
  type BadgeDef,
  type BadgeId,
} from './catalog';

export type BadgeInput = {
  createdAt: string;
  subscriptionStatus: string | null;
  subscriptionTier: string | null;
  referredByUserId: string | null;
  /** Referrals that reached active (paid) at least once. */
  activeReferralCount: number;
  /** Admin-only crown badge. */
  isAdmin?: boolean;
  nowMs?: number;
};

export type EvaluatedBadge = BadgeDef & {
  earned: boolean;
  /** ISO when the milestone was crossed, when we can infer it. */
  earnedAt: string | null;
  /** Usage stubs shown as coming soon. */
  comingSoon?: boolean;
};

const DAY_MS = 86_400_000;

function isPro(status: string | null, tier: string | null): boolean {
  const s = String(status || '').toLowerCase();
  return (s === 'active' || s === 'trialing') && String(tier || '').toLowerCase() === 'pro';
}

function daysSince(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (nowMs - t) / DAY_MS);
}

function addDaysIso(iso: string, days: number): string {
  const t = Date.parse(iso);
  return new Date(t + days * DAY_MS).toISOString();
}

function earnedIdSet(input: BadgeInput): { ids: Set<BadgeId>; earnedAt: Map<string, string | null> } {
  const nowMs = input.nowMs ?? Date.now();
  const ageDays = daysSince(input.createdAt, nowMs);
  const pro = isPro(input.subscriptionStatus, input.subscriptionTier);
  const ids = new Set<BadgeId>();
  const earnedAt = new Map<string, string | null>();

  const mark = (id: BadgeId, at: string | null) => {
    ids.add(id);
    earnedAt.set(id, at);
  };

  if (input.isAdmin) mark('admin', null);
  if (ageDays < NEW_USER_DAYS) mark('new_user', input.createdAt);
  if (pro) mark('pro', null);
  else mark('free', null);

  if (ageDays >= 30) mark('member_1m', addDaysIso(input.createdAt, 30));
  if (ageDays >= 90) mark('member_3m', addDaysIso(input.createdAt, 90));
  if (ageDays >= 180) mark('member_6m', addDaysIso(input.createdAt, 180));
  if (ageDays >= 365) mark('member_1y', addDaysIso(input.createdAt, 365));

  if (input.referredByUserId) mark('referred', null);
  if (input.activeReferralCount >= 1) mark('connector', null);
  if (Date.parse(input.createdAt) < Date.parse(EARLY_BIRD_BEFORE)) mark('early_bird', input.createdAt);

  return { ids, earnedAt };
}

/** Full catalog for the picker: rarer first. Locked usage marked coming soon. Admin badge is hidden unless earned. */
export function evaluateBadges(input: BadgeInput): EvaluatedBadge[] {
  const { ids, earnedAt } = earnedIdSet(input);

  const list: EvaluatedBadge[] = BADGE_CATALOG.filter((b) => b.id !== 'admin' || ids.has('admin')).map((b) => {
    const comingSoon = b.requires === 'usage';
    const earned = !comingSoon && ids.has(b.id as BadgeId);
    return {
      ...b,
      earned,
      earnedAt: earned ? earnedAt.get(b.id) ?? null : null,
      ...(comingSoon ? { comingSoon: true as const } : {}),
    };
  });

  list.sort(compareBadgeRarity);
  return list;
}

/** Earned-only list (no stubs), rarer first. */
export function earnedBadgeIds(input: BadgeInput): BadgeId[] {
  return evaluateBadges(input)
    .filter((b) => b.earned)
    .map((b) => b.id as BadgeId);
}

/** Default name-row badges when the user has not customized: rarest earned, max 2. */
export function defaultDisplayedBadgeIds(badges: EvaluatedBadge[]): string[] {
  return badges
    .filter((b) => b.earned && !b.comingSoon)
    .slice(0, MAX_DISPLAYED_BADGES)
    .map((b) => b.id);
}

/**
 * Resolve name-row badges from a stored selection.
 * - null/undefined → auto (rarest earned, max 2)
 * - [] → show none
 * - [ids…] → earned only, order preserved, capped
 * If every stored id is invalid/uneared, fall back to auto.
 */
export function resolveDisplayedBadgeIds(
  badges: EvaluatedBadge[],
  stored: string[] | null | undefined
): string[] {
  if (stored == null) return defaultDisplayedBadgeIds(badges);
  if (stored.length === 0) return [];
  const earned = new Set(badges.filter((b) => b.earned && !b.comingSoon).map((b) => b.id));
  const cleaned: string[] = [];
  for (const id of stored) {
    if (!earned.has(id) || cleaned.includes(id)) continue;
    cleaned.push(id);
    if (cleaned.length >= MAX_DISPLAYED_BADGES) break;
  }
  return cleaned.length > 0 ? cleaned : defaultDisplayedBadgeIds(badges);
}

export function sanitizeDisplayedBadgeIds(
  badges: EvaluatedBadge[],
  next: unknown
): string[] {
  if (!Array.isArray(next)) return defaultDisplayedBadgeIds(badges);
  const earned = new Set(badges.filter((b) => b.earned && !b.comingSoon).map((b) => b.id));
  const out: string[] = [];
  for (const raw of next) {
    if (typeof raw !== 'string') continue;
    if (!earned.has(raw)) continue;
    if (out.includes(raw)) continue;
    out.push(raw);
    if (out.length >= MAX_DISPLAYED_BADGES) break;
  }
  return out;
}

export function describeBadge(id: string): BadgeDef | undefined {
  return badgeById(id);
}

/** Build earned stubs for name-row rendering when only equipped ids are known (e.g. chat). */
export function displayBadgesFromIds(ids: string[]): EvaluatedBadge[] {
  const out: EvaluatedBadge[] = [];
  for (const id of ids) {
    const def = badgeById(id);
    if (!def) continue;
    out.push({ ...def, earned: true, earnedAt: null });
  }
  return out;
}
