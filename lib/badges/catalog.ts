/**
 * Profile badges: status / tenure / social, plus usage stubs until activity tracking ships.
 */

export type BadgeKind = 'status' | 'tenure' | 'social' | 'usage';

/** Discord-style rarity. Lower rank = rarer (shown first in the picker). */
export type BadgeRarity = 'mythic' | 'epic' | 'rare' | 'uncommon' | 'common';

export type BadgeDef = {
  id: string;
  title: string;
  description: string;
  kind: BadgeKind;
  rarity: BadgeRarity;
  /** Usage badges stay locked until counters exist. */
  requires?: 'usage';
};

/** Accounts created before this count as Early bird. */
export const EARLY_BIRD_BEFORE = '2026-06-01T00:00:00.000Z';

export const NEW_USER_DAYS = 14;

/** Max badges shown next to the name. */
export const MAX_DISPLAYED_BADGES = 2;

export const RARITY_RANK: Record<BadgeRarity, number> = {
  mythic: 0,
  epic: 1,
  rare: 2,
  uncommon: 3,
  common: 4,
};

export const BADGE_CATALOG: readonly BadgeDef[] = [
  // Status
  { id: 'admin', title: 'Admin', description: 'StatTrackr admin', kind: 'status', rarity: 'mythic' },
  { id: 'new_user', title: 'New here', description: 'Joined in the last two weeks', kind: 'status', rarity: 'common' },
  { id: 'free', title: 'Free', description: 'On the free plan', kind: 'status', rarity: 'common' },
  { id: 'pro', title: 'Pro', description: 'Active Pro member', kind: 'status', rarity: 'uncommon' },

  // Tenure
  { id: 'member_1m', title: '1 month in', description: 'Been around for a month', kind: 'tenure', rarity: 'common' },
  { id: 'member_3m', title: '3 months in', description: 'Three months on StatTrackr', kind: 'tenure', rarity: 'uncommon' },
  { id: 'member_6m', title: '6 months in', description: 'Half a year with us', kind: 'tenure', rarity: 'rare' },
  { id: 'member_1y', title: '1 year in', description: 'A full year on StatTrackr', kind: 'tenure', rarity: 'epic' },

  // Social
  { id: 'referred', title: 'Invited', description: "Signed up with a mate's referral", kind: 'social', rarity: 'uncommon' },
  { id: 'connector', title: 'Connector', description: 'Brought at least one paying mate', kind: 'social', rarity: 'epic' },
  { id: 'early_bird', title: 'Early bird', description: 'Joined before the early cohort cutoff', kind: 'social', rarity: 'mythic' },

  // Usage stubs (v2)
  {
    id: 'researcher_50',
    title: 'Curious',
    description: 'Researched 50 props in a month',
    kind: 'usage',
    rarity: 'rare',
    requires: 'usage',
  },
  {
    id: 'researcher_500',
    title: 'Expert researcher',
    description: 'Researched 500 props in a month',
    kind: 'usage',
    rarity: 'epic',
    requires: 'usage',
  },
  {
    id: 'ai_watcher',
    title: 'AI watcher',
    description: 'Opened AI picks regularly',
    kind: 'usage',
    rarity: 'rare',
    requires: 'usage',
  },
] as const;

export type BadgeId = (typeof BADGE_CATALOG)[number]['id'];

export const badgeById = (id: string): BadgeDef | undefined => BADGE_CATALOG.find((b) => b.id === id);

export function compareBadgeRarity(a: BadgeDef, b: BadgeDef): number {
  const d = RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity];
  return d !== 0 ? d : a.title.localeCompare(b.title);
}
