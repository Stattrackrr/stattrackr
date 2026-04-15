/**
 * Pure DFS / fantasy position helpers (no Node fs). Safe to import from Client Components.
 */

export type DfsRolePlayer = {
  name?: string;
  normalizedName?: string;
  roleGroup?: string;
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

/** Short header label aligned with app/afl/page.tsx dfsRoleGroupToHeaderLabel. */
export function dfsRoleGroupToShortLabel(roleGroup: string | null | undefined): string | null {
  const key = String(roleGroup || '').trim().toLowerCase();
  if (!key) return null;
  if (key === 'key forward') return 'KEY FWD';
  if (key === 'small/medium forward') return 'GEN FWD';
  if (key === 'inside midfielder') return 'INS MID';
  if (key === 'ruck') return 'RUCK';
  if (key === 'wing/attacking defender') return 'WNG DEF';
  if (key === 'general defender') return 'GEN DEF';
  if (key === 'designated kicker') return 'DES KCK';
  return String(roleGroup).trim();
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

export function findDfsRoleGroup(players: DfsRolePlayer[], playerName: string): string | null {
  const target = normalizeDfsRolePlayerKey(playerName);
  if (!target) return null;
  let match =
    players.find((p) => normalizeDfsRolePlayerKey(p.normalizedName || p.name || '') === target) || null;
  if (!match) {
    match =
      players.find((p) => {
        const n = normalizeDfsRolePlayerKey(p.normalizedName || p.name || '');
        return n.includes(target) || target.includes(n);
      }) || null;
  }
  const g = match?.roleGroup;
  return typeof g === 'string' && g.trim() ? g.trim() : null;
}
