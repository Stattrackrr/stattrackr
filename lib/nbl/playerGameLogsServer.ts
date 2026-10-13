/**
 * Server reader for committed NBL player game logs (data/nbl-model/cache/player-logs/<id>-<year>.json).
 * Rosetta fetch happens in `scripts/fetch-nbl-player-game-logs.ts`, not per request.
 */

import fs from 'fs';
import path from 'path';
import { enrichGameLogsFromSchedule } from '@/lib/nbl/enrichGameLogsFromSchedule';
import { overlayNblQuarterPoints } from '@/lib/nbl/nblPbpData';
import { withComputedNblBoxStats } from '@/lib/nbl/rosettaPlayer';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { enrichNblGamesAdvancedRates } from '@/lib/nbl/teamBoxScores';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';

export type NblPlayerGameLogs = {
  playerId: string;
  name: string | null;
  team: string | null;
  games: NblGameLogRow[];
};

function finalizeGames(games: NblGameLogRow[], year: number, playerName?: string | null): NblGameLogRow[] {
  return overlayNblQuarterPoints(
    enrichNblGamesAdvancedRates(
      enrichGameLogsFromSchedule(games, year).map((g) => withComputedNblBoxStats(g)),
      year
    ),
    playerName,
    year
  );
}

function cachePath(playerId: string, year: number): string {
  return path.join(process.cwd(), 'data', 'nbl-model', 'cache', 'player-logs', `${playerId}-${year}.json`);
}

function readCachedPayload(playerId: string, year: number): {
  games: NblGameLogRow[];
  name: string | null;
  team: string | null;
} | null {
  const file = cachePath(playerId, year);
  if (!fs.existsSync(file)) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      games?: NblGameLogRow[];
      name?: string | null;
      team?: string | null;
    };
    const cachedGames = Array.isArray(cached.games) ? cached.games : [];
    return {
      games: cachedGames.map((g) => withComputedNblBoxStats(g)),
      name: cached.name ? String(cached.name) : null,
      team: cached.team ? String(cached.team) : null,
    };
  } catch {
    return null;
  }
}

function loadYearGames(
  playerId: string,
  year: number,
  meta: { name: string | null; team: string | null }
): NblGameLogRow[] {
  const cached = readCachedPayload(playerId, year);
  if (cached == null) return [];
  const name = meta.name || cached.name;
  if (!meta.name && cached.name) meta.name = cached.name;
  if (!meta.team && cached.team) meta.team = cached.team;
  return finalizeGames(cached.games, year, name);
}

function mergeGames(batches: NblGameLogRow[][]): NblGameLogRow[] {
  const seen = new Set<string>();
  const out: NblGameLogRow[] = [];
  for (const games of batches) {
    for (const g of games) {
      const key = `${g.matchId ?? ''}|${g.date ?? ''}|${g.season ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(g);
    }
  }
  return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

type RosterPlayer = { playerId: string; name: string; team?: string };

function findInRosters(years: number[], match: (p: RosterPlayer) => boolean): RosterPlayer | null {
  for (const y of years.length ? years : [NBL_CURRENT_SEASON_YEAR]) {
    const rosterFile = path.join(process.cwd(), 'data', `nbl-roster-${y}.json`);
    if (!fs.existsSync(rosterFile)) continue;
    try {
      const roster = JSON.parse(fs.readFileSync(rosterFile, 'utf8')) as { players?: RosterPlayer[] };
      const hit = (roster.players || []).find(match);
      if (hit) return hit;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Game logs for one player across `years`, oldest first. `name` is an exact (case-insensitive) roster name. */
export function loadNblPlayerGameLogs(opts: {
  playerId?: string | null;
  name?: string | null;
  years: number[];
}): NblPlayerGameLogs | null {
  const wantName = String(opts.name || '').trim().toLowerCase();
  let resolvedId = String(opts.playerId || '').trim();
  let resolvedName: string | null = null;
  let resolvedTeam: string | null = null;

  if (!resolvedId && wantName) {
    const hit = findInRosters(opts.years, (p) => String(p.name || '').toLowerCase() === wantName);
    if (hit) {
      resolvedId = hit.playerId;
      resolvedName = hit.name;
      resolvedTeam = hit.team ?? null;
    }
  }
  if (!resolvedId) return null;
  if (!resolvedName) {
    const hit = findInRosters(opts.years, (p) => p.playerId === resolvedId);
    if (hit) {
      resolvedName = hit.name;
      resolvedTeam = hit.team ?? resolvedTeam;
    }
  }

  const meta = { name: resolvedName, team: resolvedTeam };
  const games = mergeGames(opts.years.map((y) => loadYearGames(resolvedId, y, meta)));
  return { playerId: resolvedId, name: meta.name || resolvedName, team: meta.team || resolvedTeam, games };
}
