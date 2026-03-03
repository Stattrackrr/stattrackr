/**
 * Resolve AFL player name -> current team using league player stats (FootyWire).
 * Used so props/stats use the player's actual team (handles trades, team moves).
 */

import { leagueTeamToOfficial } from '@/lib/aflTeamMapping';

const CURRENT_SEASON = new Date().getFullYear();

function normalizeName(name: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export type PlayerTeamMap = Map<string, string>;

/**
 * Fetch league player stats and build map: normalized player name -> official team name.
 * Returns empty map if fetch fails.
 */
export async function getAflPlayerTeamMap(baseUrl: string, season: number = CURRENT_SEASON): Promise<PlayerTeamMap> {
  const url = `${baseUrl}/api/afl/league-player-stats?season=${season}`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return new Map();
    const data = (await r.json()) as { players?: Array<{ name?: string; team?: string }> };
    const players = data?.players ?? [];
    const map: PlayerTeamMap = new Map();
    for (const p of players) {
      const name = (p?.name ?? '').trim();
      const leagueTeam = (p?.team ?? '').trim();
      if (!name || !leagueTeam) continue;
      const official = leagueTeamToOfficial(leagueTeam) ?? leagueTeam;
      map.set(normalizeName(name), official);
    }
    return map;
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
  const key = normalizeName(playerName);
  const officialTeam = playerTeamMap.get(key);
  if (!officialTeam) return null;
  const h = (homeTeam || '').trim();
  const a = (awayTeam || '').trim();
  if (gameTeamMatchesOfficial(h, officialTeam)) return { team: officialTeam, opponent: a };
  if (gameTeamMatchesOfficial(a, officialTeam)) return { team: officialTeam, opponent: h };
  return null;
}
