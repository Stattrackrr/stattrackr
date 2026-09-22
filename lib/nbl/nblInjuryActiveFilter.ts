/**
 * Drop stale injury-list rows when the player already played their team's
 * most recent completed game this season.
 */

import fs from 'fs';
import path from 'path';
import type { NblInjuryRow } from '@/lib/nbl/basketballComAuInjuries';
import {
  isCompletedGame,
  loadScheduleGames,
  nblShotPlayerNamesMatch,
} from '@/lib/nbl/nblShotChartData';
import type { NblGameLogRow, NblLeaguePlayerStatRow } from '@/lib/nbl/rosettaTypes';
import { NBL_CURRENT_SEASON_YEAR, normalizeTeamKey, resolveNblClubName } from '@/lib/nblTeamCanonical';

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = resolveNblClubName(String(a || ''));
  const cb = resolveNblClubName(String(b || ''));
  if (ca && cb) return normalizeTeamKey(ca) === normalizeTeamKey(cb);
  return normalizeTeamKey(String(a || '')) === normalizeTeamKey(String(b || ''));
}

function loadLeaguePlayers(year: number): NblLeaguePlayerStatRow[] {
  const file = path.join(process.cwd(), 'data', `nbl-league-player-stats-${year}.json`);
  const data = readJson<{ players?: NblLeaguePlayerStatRow[] }>(file);
  return Array.isArray(data?.players) ? data.players : [];
}

function loadPlayerGames(playerId: string, year: number): NblGameLogRow[] {
  const file = path.join(
    process.cwd(),
    'data',
    'nbl-model',
    'cache',
    'player-logs',
    `${playerId}-${year}.json`
  );
  const data = readJson<{ games?: NblGameLogRow[] }>(file);
  return Array.isArray(data?.games) ? data.games : [];
}

function matchLeaguePlayer(
  players: NblLeaguePlayerStatRow[],
  name: string,
  team: string
): NblLeaguePlayerStatRow | null {
  const named = players.filter((p) => nblShotPlayerNamesMatch(p.name, name));
  if (!named.length) return null;
  const onTeam = named.filter((p) => teamsMatch(p.team, team) || teamsMatch(p.teamCode, team));
  return (onTeam[0] || named[0]) ?? null;
}

function latestTeamGame(team: string, year: number) {
  const games = loadScheduleGames([year])
    .filter(isCompletedGame)
    .filter((g) => teamsMatch(g.homeTeam, team) || teamsMatch(g.awayTeam, team))
    .sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
  return games[0] || null;
}

function playedLatestGame(player: NblLeaguePlayerStatRow, team: string, year: number): boolean {
  const latest = latestTeamGame(team || player.team, year);
  if (!latest) return (player.games ?? 0) >= 1;

  const games = loadPlayerGames(player.playerId, year);
  const latestIds = new Set(
    [latest.id, latest.externalId].map((id) => String(id || '').trim()).filter(Boolean)
  );
  const latestDay = String(latest.startTime || '').slice(0, 10);

  for (const g of games) {
    const mins = Number(g.minutes);
    if (Number.isFinite(mins) && mins <= 0) continue;
    const matchId = String(g.matchId || '').trim();
    if (matchId && latestIds.has(matchId)) return true;
    const day = String(g.date || '').slice(0, 10);
    if (latestDay && day === latestDay) return true;
  }

  return false;
}

export function omitPlayersWhoPlayedLatestGame(
  injuries: NblInjuryRow[],
  year: number = NBL_CURRENT_SEASON_YEAR
): NblInjuryRow[] {
  const players = loadLeaguePlayers(year);
  if (!injuries.length || !players.length) return injuries;

  return injuries.filter((row) => {
    const player = matchLeaguePlayer(players, row.player, row.team);
    if (!player) return true;
    return !playedLatestGame(player, row.team, year);
  });
}
