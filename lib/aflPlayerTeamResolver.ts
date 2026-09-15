/**
 * Resolve AFL player name -> current team using league player stats (FootyWire).
 * Used so props/stats use the player's actual team (handles trades, team moves).
 */

import path from 'path';
import fs from 'fs/promises';
import { leagueTeamToOfficial } from '@/lib/aflTeamMapping';
import { aflPlayerNameMatchKeys, normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';

const CURRENT_SEASON = new Date().getFullYear();

function setPlayerTeamKeys(map: PlayerTeamMap, name: string, official: string): void {
  for (const key of aflPlayerNameMatchKeys(name)) {
    map.set(key, official);
  }
}

function buildMapFromPlayers(players: Array<{ name?: string; team?: string }>): PlayerTeamMap {
  const map: PlayerTeamMap = new Map();
  for (const p of players) {
    const name = (p?.name ?? '').trim();
    const leagueTeam = (p?.team ?? '').trim();
    if (!name || !leagueTeam) continue;
    const official = leagueTeamToOfficial(leagueTeam) ?? leagueTeam;
    setPlayerTeamKeys(map, name, official);
  }
  return map;
}

/** Look up a player's team trying Matt/Matthew-style aliases across one or more maps. */
export function lookupAflPlayerTeamFromMaps(
  playerName: string,
  ...maps: Array<PlayerTeamMap | Map<string, string> | null | undefined>
): string | null {
  for (const key of aflPlayerNameMatchKeys(playerName)) {
    for (const map of maps) {
      const team = map?.get(key);
      if (team) return team;
    }
  }
  return null;
}

export type PlayerTeamMap = Map<string, string>;

/**
 * Build player team map from data/afl-league-player-stats-{season}.json (for cron so we don't depend on self-fetch).
 * Loads year-2 then year-1 then current so 2026 overwrites, but 2024 still covers players missing from later files.
 */
export async function getAflPlayerTeamMapFromFiles(): Promise<PlayerTeamMap> {
  const year = new Date().getFullYear();
  const map: PlayerTeamMap = new Map();
  for (const season of [year - 2, year - 1, year]) {
    if (season < 2020) continue;
    try {
      const filePath = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
      const raw = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(raw) as { players?: Array<{ name?: string; team?: string }> };
      const players = data?.players ?? [];
      for (const p of players) {
        const name = (p?.name ?? '').trim();
        const leagueTeam = (p?.team ?? '').trim();
        if (!name || !leagueTeam) continue;
        const official = leagueTeamToOfficial(leagueTeam) ?? leagueTeam;
        setPlayerTeamKeys(map, name, official);
      }
    } catch {
      /* ignore */
    }
  }
  return map;
}

/** Resolve a player's team for a given season from league stats (for next-game when only player_name is provided). */
export async function getPlayerTeamForSeason(season: number, playerName: string): Promise<string | null> {
  if (season < 2020 || !playerName || typeof playerName !== 'string') return null;
  try {
    const filePath = path.join(process.cwd(), 'data', `afl-league-player-stats-${season}.json`);
    const raw = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as { players?: Array<{ name?: string; team?: string }> };
    if (!Array.isArray(data?.players)) return null;
    const wanted = new Set(aflPlayerNameMatchKeys(playerName.trim()));
    const row = data.players.find((p) => wanted.has(normalizeAflPlayerNameForMatch((p?.name ?? '').trim())));
    if (!row?.team) return null;
    const official = leagueTeamToOfficial(row.team.trim()) ?? row.team.trim();
    return official || null;
  } catch {
    return null;
  }
}

export async function getAflPlayerTeamMap(baseUrl: string, season: number = CURRENT_SEASON): Promise<PlayerTeamMap> {
  const url = `${baseUrl}/api/afl/league-player-stats?season=${season}`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return new Map();
    const data = (await r.json()) as { players?: Array<{ name?: string; team?: string }> };
    const players = data?.players ?? [];
    return buildMapFromPlayers(players);
  } catch {
    return new Map();
  }
}

function gameTeamMatchesOfficial(gameTeam: string, officialTeam: string): boolean {
  if (!gameTeam || !officialTeam) return false;
  const g = gameTeam.trim().toLowerCase();
  const o = officialTeam.trim().toLowerCase();
  if (g === o) return true;
  if (o.startsWith(g) || g.startsWith(o.split(' ')[0] ?? '')) return true;
  return false;
}

/**
 * Resolve (playerName, homeTeam, awayTeam) to (team, opponent) using current team from league stats.
 * If player is in the map and their team matches one of home/away, returns that team and the other as opponent.
 * Otherwise returns null and caller should try both orientations.
 */
export function resolveTeamAndOpponent(
  playerName: string,
  homeTeam: string,
  awayTeam: string,
  playerTeamMap: PlayerTeamMap
): { team: string; opponent: string } | null {
  const officialTeam = lookupAflPlayerTeamFromMaps(playerName, playerTeamMap);
  if (!officialTeam) return null;
  const h = (homeTeam || '').trim();
  const a = (awayTeam || '').trim();
  if (gameTeamMatchesOfficial(h, officialTeam)) return { team: officialTeam, opponent: a };
  if (gameTeamMatchesOfficial(a, officialTeam)) return { team: officialTeam, opponent: h };
  return null;
}
