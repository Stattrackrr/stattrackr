/**
 * Pure DFS / fantasy position helpers (no Node fs). Safe to import from Client Components.
 */

export type DfsRolePlayer = {
  name?: string;
  normalizedName?: string;
  roleGroup?: string;
  /** Fantasy DvP bucket derived from DFS role group (same rules as `scripts/fetch-afl-dfs-role-map.js`). */
  roleBucket?: 'DEF' | 'MID' | 'FWD' | 'RUC' | null;
};

/** Same normalization as GET /api/afl/dfs-role for consistent matching. */
export function normalizeDfsRolePlayerKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Given-name aliases so roster/props spelling (e.g. Lachlan) matches DFS export spelling (e.g. Lachie).
 * Keys are first-token lowercase after {@link normalizeDfsRolePlayerKey}; values are canonical first tokens.
 */
const DFS_GIVEN_NAME_CANONICAL: Record<string, string> = {
  lachie: 'lachlan',
};

/**
 * Stable key for matching DFS role rows when official AFL register uses a different first-name spelling
 * than the DFS site / static map.
 */
export function normalizeDfsRolePlayerMatchKey(name: string): string {
  const base = normalizeDfsRolePlayerKey(name);
  const parts = base.split(' ').filter(Boolean);
  if (parts.length < 2) return base;
  const canon = DFS_GIVEN_NAME_CANONICAL[parts[0]] ?? parts[0];
  if (canon === parts[0]) return base;
  return [canon, ...parts.slice(1)].join(' ');
}

/** Normalize DFS Australia `positionGroup` / stored `roleGroup` for comparisons. */
function normalizeDfsRoleGroupKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Short DFS sub-position label (KEY FWD, WNG DEF, DES KCK, …).
 * Covers every `positionGroup` string we see from DFS Australia’s DVP export
 * (see `scripts/fetch-afl-dfs-role-map.js`): seven canonical groups plus common wording variants.
 * Anything unknown is returned trimmed as-is.
 */
export function dfsRoleGroupToShortLabel(roleGroup: string | null | undefined): string | null {
  const raw = String(roleGroup ?? '').trim();
  if (!raw) return null;
  const key = normalizeDfsRoleGroupKey(raw);

  // Canonical positionGroup strings from the site
  if (key === 'key forward') return 'KEY FWD';
  if (key === 'small/medium forward') return 'GEN FWD';
  if (key === 'inside midfielder') return 'INS MID';
  if (key === 'ruck') return 'RUCK';
  if (key === 'wing/attacking defender') return 'WNG DEF';
  if (key === 'general defender') return 'GEN DEF';
  if (key === 'designated kicker') return 'DES KCK';

  // Phrase variants (spacing/casing/wording)
  if (key.includes('designated') && key.includes('kicker')) return 'DES KCK';
  if (key.includes('wing') && key.includes('defender')) return 'WNG DEF';
  if (key.includes('general') && key.includes('defender')) return 'GEN DEF';
  if (key.includes('inside') && key.includes('midfield')) return 'INS MID';
  if (key.includes('key') && key.includes('forward')) return 'KEY FWD';
  if ((key.includes('small') || key.includes('medium')) && key.includes('forward')) return 'GEN FWD';
  if (key === 'ruckman') return 'RUCK';

  return raw;
}

/**
 * Prefer role from DFS Australia map; when the map is empty or the player is missing, use DvP-bucket
 * fallbacks so list/props headers still show Fantasy · DFS style (e.g. MID → INS MID, DEF → GEN DEF).
 */
export function resolveDfsRoleDisplayLabel(
  roleGroupFromFile: string | null | undefined,
  fantasyDvp: string | null | undefined
): string | null {
  const fromFile = dfsRoleGroupToShortLabel(roleGroupFromFile);
  if (fromFile) return fromFile;
  const raw = String(fantasyDvp ?? '')
    .trim()
    .toUpperCase();
  if (raw === 'RUC') return 'RUCK';
  if (raw === 'DEF') return 'GEN DEF';
  if (raw === 'MID') return 'INS MID';
  if (raw === 'FWD') return 'GEN FWD';
  return null;
}

export function normalizeFantasyPositionToDvp(raw: string): 'DEF' | 'MID' | 'FWD' | 'RUC' {
  const pos = String(raw || '').trim().toUpperCase();
  if (pos === 'DEF' || pos === 'MID' || pos === 'FWD' || pos === 'RUC') return pos;
  if (pos === 'KD' || pos === 'MD') return 'DEF';
  if (pos === 'M/F') return 'MID';
  if (pos.includes('MID')) return 'MID';
  if (pos.includes('DEF')) return 'DEF';
  if (pos.includes('FWD')) return 'FWD';
  if (pos.includes('RUC')) return 'RUC';
  return 'MID';
}

/** Map DFS Australia `positionGroup` / static role title to DvP bucket. */
export function roleBucketFromDfsRoleGroup(group: string | null | undefined): 'DEF' | 'MID' | 'FWD' | 'RUC' | null {
  const g = String(group || '').toLowerCase();
  if (!g) return null;
  if (g.includes('inside midfielder')) return 'MID';
  if (g.includes('ruck')) return 'RUC';
  if (g.includes('forward')) return 'FWD';
  if (g.includes('defender') || g.includes('kicker')) return 'DEF';
  return null;
}

export function findDfsRolePlayer(players: DfsRolePlayer[], playerName: string): DfsRolePlayer | null {
  if (!normalizeDfsRolePlayerKey(playerName)) return null;
  const target = normalizeDfsRolePlayerMatchKey(playerName);
  let match =
    players.find(
      (p) => normalizeDfsRolePlayerMatchKey(p.normalizedName || p.name || '') === target
    ) || null;
  if (!match) {
    match =
      players.find((p) => {
        const n = normalizeDfsRolePlayerMatchKey(p.normalizedName || p.name || '');
        return n.includes(target) || target.includes(n);
      }) || null;
  }
  return match ?? null;
}

export function findDfsRoleGroup(players: DfsRolePlayer[], playerName: string): string | null {
  const g = findDfsRolePlayer(players, playerName)?.roleGroup;
  return typeof g === 'string' && g.trim() ? g.trim() : null;
}
