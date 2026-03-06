/**
 * Resolve AFL player name -> current team using league player stats (FootyWire).
 * Used so props/stats use the player's actual team (handles trades, team moves).
 */

import path from 'path';
import fs from 'fs/promises';
import { leagueTeamToOfficial } from '@/lib/aflTeamMapping';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';

const CURRENT_SEASON = new Date().getFullYear();

function buildMapFromPlayers(players: Array<{ name?: string; team?: string }>): PlayerTeamMap {
  const map: PlayerTeamMap = new Map();
  for (const p of players) {
    const name = (p?.name ?? '').trim();
    const leagueTeam = (p?.team ?? '').trim();
    if (!name || !leagueTeam) continue;
    const official = leagueTeamToOfficial(leagueTeam) ?? leagueTeam;
    map.set(normalizeAflPlayerNameForMatch(name), official);
  }
  return map;
}

export type PlayerTeamMap = Map<string, string>;

/**
 * Fetch league player stats and build map: normalized player name -> official team name.
 * Returns empty map if fetch fails.
 */
/**
 * Build player team map from data/afl-league-player-stats-{season}.json (for cron so we don't depend on self-fetch).
 * Uses previous season then current season so 2026 overrides 2025 for same player.
 */
export async function getAflPlayerTeamMapFromFiles(): Promise<PlayerTeamMap> {
  const year = new Date().getFullYear();
  const map: PlayerTeamMap = new Map();
  for (const season of [year - 1, year]) {
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
        map.set(normalizeAflPlayerNameForMatch(name), official);
      }
    } catch {
      /* ignore */
    }
  }
  return map;
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
  const key = normalizeAflPlayerNameForMatch(playerName);
  const officialTeam = playerTeamMap.get(key);
  if (!officialTeam) return null;
  const h = (homeTeam || '').trim();
  const a = (awayTeam || '').trim();
  if (gameTeamMatchesOfficial(h, officialTeam)) return { team: officialTeam, opponent: a };
  if (gameTeamMatchesOfficial(a, officialTeam)) return { team: officialTeam, opponent: h };
  return null;
}
