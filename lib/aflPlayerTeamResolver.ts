/**
 * Resolve AFL player name -> current team using league player stats (FootyWire).
 * Used so props/stats use the player's actual team (handles trades, team moves).
 */

import { leagueTeamToOfficial } from '@/lib/aflTeamMapping';
import { normalizeAflPlayerNameForMatch } from '@/lib/aflPlayerNameUtils';

const CURRENT_SEASON = new Date().getFullYear();

export type PlayerTeamMap = Map<string, string>;

/**
 * Fetch league player stats and build map: normalized player name -> official team name.
 * Loads previous season (e.g. 2025) first as the full baseline, then overlays current season
 * (e.g. 2026) so everyone has at least last year's team and current-season data overrides when present.
 * Returns empty map if both fetches fail.
 */
export async function getAflPlayerTeamMap(baseUrl: string, season: number = CURRENT_SEASON): Promise<PlayerTeamMap> {
  const map: PlayerTeamMap = new Map();
  const prevSeason = Math.max(2020, season - 1);
  for (const s of [prevSeason, season]) {
    try {
      const url = `${baseUrl}/api/afl/league-player-stats?season=${s}`;
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const data = (await r.json()) as { players?: Array<{ name?: string; team?: string }> };
      const players = data?.players ?? [];
      for (const p of players) {
        const name = (p?.name ?? '').trim();
        const leagueTeam = (p?.team ?? '').trim();
        if (!name || !leagueTeam) continue;
        const key = normalizeAflPlayerNameForMatch(name);
        const official = leagueTeamToOfficial(leagueTeam) ?? leagueTeam;
        map.set(key, official);
      }
    } catch {
      // continue with next season
    }
  }
  return map;
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
