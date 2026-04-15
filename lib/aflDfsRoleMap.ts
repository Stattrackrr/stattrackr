/**
 * Server-side: load DFS role map from disk. Re-exports pure helpers from aflDfsRoleLabels
 * so API routes can import one module; Client Components must import aflDfsRoleLabels only.
 */

import fs from 'fs/promises';
import path from 'path';

import type { DfsRolePlayer } from './aflDfsRoleLabels';

export type { DfsRolePlayer };

export {
  normalizeDfsRolePlayerKey,
  dfsRoleGroupToShortLabel,
  resolveDfsRoleDisplayLabel,
  normalizeFantasyPositionToDvp,
  findDfsRoleGroup,
} from './aflDfsRoleLabels';

type DfsRoleFile = {
  season?: number;
  generatedAt?: string;
  players?: DfsRolePlayer[];
};

const DFS_ROLE_FILE = path.join(process.cwd(), 'data', 'afl-dfs-role-map-latest.json');

let dfsPlayersCache: { expiresAt: number; players: DfsRolePlayer[] } | null = null;
const DFS_PLAYERS_CACHE_TTL_MS = 5 * 60 * 1000;

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
