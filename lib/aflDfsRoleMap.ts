import fs from 'fs/promises';
import path from 'path';

type DfsRolePlayer = {
  name?: string;
  normalizedName?: string;
  roleGroup?: string;
};

type DfsRoleFile = {
  season?: number;
  generatedAt?: string;
  players?: DfsRolePlayer[];
};

const DFS_ROLE_FILE = path.join(process.cwd(), 'data', 'afl-dfs-role-map-latest.json');

let dfsPlayersCache: { expiresAt: number; players: DfsRolePlayer[] } | null = null;
const DFS_PLAYERS_CACHE_TTL_MS = 5 * 60 * 1000;

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
 * Prefer role from DFS Australia map; when the map is empty or the player is missing, use a minimal
 * DvP-aware fallback so headers still match Defense-vs-Position copy (e.g. RUC → RUCK).
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

export async function loadDfsRolePlayers(): Promise<DfsRolePlayer[]> {
  const now = Date.now();
  if (dfsPlayersCache && dfsPlayersCache.expiresAt > now) {
    return dfsPlayersCache.players;
  }
  try {
    const raw = await fs.readFile(DFS_ROLE_FILE, 'utf8');
    const data = JSON.parse(raw) as DfsRoleFile;
    const players = Array.isArray(data.players) ? data.players : [];
    dfsPlayersCache = { expiresAt: now + DFS_PLAYERS_CACHE_TTL_MS, players };
    return players;
  } catch {
    dfsPlayersCache = { expiresAt: now + DFS_PLAYERS_CACHE_TTL_MS, players: [] };
    return [];
  }
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
