/**
 * Server-side: load DFS role map from disk. Re-exports pure helpers from aflDfsRoleLabels
 * so API routes can import one module; Client Components must import aflDfsRoleLabels only.
 */

import fs from 'fs/promises';
import path from 'path';

import type { DfsRolePlayer } from './aflDfsRoleLabels';
import { normalizeDfsRolePlayerMatchKey, roleBucketFromDfsRoleGroup } from './aflDfsRoleLabels';

export type { DfsRolePlayer };

export {
  normalizeDfsRolePlayerKey,
  normalizeDfsRolePlayerMatchKey,
  dfsRoleGroupToShortLabel,
  resolveDfsRoleDisplayLabel,
  normalizeFantasyPositionToDvp,
  findDfsRoleGroup,
  findDfsRolePlayer,
  roleBucketFromDfsRoleGroup,
} from './aflDfsRoleLabels';

type DfsRoleFile = {
  season?: number;
  generatedAt?: string;
  players?: DfsRolePlayer[];
};

type AllTeamsDfsRoleFile = {
  generatedAt?: string;
  teams?: Record<string, Record<string, string[]>>;
};

const DFS_ROLE_FILE = path.join(process.cwd(), 'data', 'afl-dfs-role-map-latest.json');
const DFS_ROLE_STATIC_CANDIDATES = [
  path.join(process.cwd(), 'data', 'afl-dfs-role-map-static.json'),
  path.join(process.cwd(), 'dfs-role-map-all-teams.json'),
];

type DfsRoleMapCache = {
  expiresAt: number;
  players: DfsRolePlayer[];
  season: number | null;
  generatedAt: string | null;
};

let dfsPlayersCache: DfsRoleMapCache | null = null;
const DFS_PLAYERS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Strip suffix noise from names in `dfs-role-map-all-teams.json` (same idea as fetch script HTML cleanup). */
function cleanDfsMappedPlayerName(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/\s*\(.*?\)\s*$/g, '')
    .replace(/\s+injured\s*$/i, '')
    .replace(/injured$/i, '')
    .trim();
}

function flattenAllTeamsDfsRoleMap(data: AllTeamsDfsRoleFile): DfsRolePlayer[] {
  const teams = data?.teams;
  if (!teams || typeof teams !== 'object') return [];
  const byNorm = new Map<string, DfsRolePlayer>();
  for (const groups of Object.values(teams)) {
    if (!groups || typeof groups !== 'object') continue;
    for (const [roleTitle, names] of Object.entries(groups)) {
      if (!Array.isArray(names)) continue;
      const rg = String(roleTitle || '').trim();
      const roleGroup = rg === '' ? undefined : rg;
      for (const rawName of names) {
        const name = cleanDfsMappedPlayerName(rawName);
        if (!name) continue;
        const matchKey = normalizeDfsRolePlayerMatchKey(name);
        if (!matchKey) continue;
        byNorm.set(matchKey, {
          name,
          normalizedName: matchKey,
          roleGroup,
          roleBucket: roleGroup ? roleBucketFromDfsRoleGroup(roleGroup) : null,
        });
      }
    }
  }
  return Array.from(byNorm.values());
}

async function readLatestDfsRoleFile(): Promise<{
  players: DfsRolePlayer[];
  season: number | null;
  generatedAt: string | null;
}> {
  try {
    const raw = await fs.readFile(DFS_ROLE_FILE, 'utf8');
    const data = JSON.parse(raw) as DfsRoleFile;
    const players = Array.isArray(data.players) ? data.players : [];
    return {
      players,
      season: typeof data.season === 'number' ? data.season : null,
      generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : null,
    };
  } catch {
    return { players: [], season: null, generatedAt: null };
  }
}

async function tryLoadStaticDfsRolePlayers(): Promise<{
  players: DfsRolePlayer[];
  generatedAt: string | null;
}> {
  for (const p of DFS_ROLE_STATIC_CANDIDATES) {
    try {
      const raw = await fs.readFile(p, 'utf8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      const generatedAt = typeof data.generatedAt === 'string' ? data.generatedAt : null;
      if (Array.isArray(data.players) && data.players.length > 0) {
        return { players: data.players as DfsRolePlayer[], generatedAt };
      }
      const teams = data.teams;
      if (teams && typeof teams === 'object') {
        const flat = flattenAllTeamsDfsRoleMap(data as AllTeamsDfsRoleFile);
        if (flat.length > 0) return { players: flat, generatedAt };
      }
    } catch {
      continue;
    }
  }
  return { players: [], generatedAt: null };
}

async function loadDfsRoleMapBundleInternal(): Promise<{
  players: DfsRolePlayer[];
  season: number | null;
  generatedAt: string | null;
}> {
  const now = Date.now();
  if (dfsPlayersCache && dfsPlayersCache.expiresAt > now) {
    return {
      players: dfsPlayersCache.players,
      season: dfsPlayersCache.season,
      generatedAt: dfsPlayersCache.generatedAt,
    };
  }

  const latest = await readLatestDfsRoleFile();
  let players = latest.players;
  let season = latest.season;
  let generatedAt = latest.generatedAt;

  if (players.length === 0) {
    const st = await tryLoadStaticDfsRolePlayers();
    players = st.players;
    season = null;
    generatedAt = st.generatedAt;
  }

  dfsPlayersCache = {
    expiresAt: now + DFS_PLAYERS_CACHE_TTL_MS,
    players,
    season,
    generatedAt,
  };
  return { players, season, generatedAt };
}

export async function loadDfsRoleMapBundle(): Promise<{
  players: DfsRolePlayer[];
  season: number | null;
  generatedAt: string | null;
}> {
  return loadDfsRoleMapBundleInternal();
}

export async function loadDfsRolePlayers(): Promise<DfsRolePlayer[]> {
  const { players } = await loadDfsRoleMapBundleInternal();
  return players;
}
