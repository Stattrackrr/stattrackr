/**
 * NBL Game Props team logs — NBA TEAM_STAT_OPTIONS values from schedule + period cache.
 */

import fs from 'fs';
import path from 'path';
import type { NblPeriodScores } from '@/lib/nbl/sportRadarPeriods';
import {
  NBL_CHART_HISTORY_YEARS,
  normalizeTeamKey,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';

export type NblScheduleGame = {
  id?: string;
  externalId?: string | null;
  startTime?: string | null;
  round?: string | number | null;
  status?: string | null;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  venue?: string | null;
};

export type NblPeriodScoreCacheEntry = Pick<
  NblPeriodScores,
  | 'home_q1'
  | 'home_q2'
  | 'home_q3'
  | 'home_q4'
  | 'visitor_q1'
  | 'visitor_q2'
  | 'visitor_q3'
  | 'visitor_q4'
>;

export type NblTeamGameLogRow = {
  matchId: string;
  date: string | null;
  season: number;
  round: string | number | null;
  opponent: string;
  opponentCode: string | null;
  isHome: boolean;
  team: string;
  teamCode: string | null;
  result: string | null;
  venue: string | null;
  teamScore: number;
  oppScore: number;
  homeScore: number;
  awayScore: number;
  hasPeriodScores: boolean;
  moneyline: number;
  spread: number;
  total_pts: number;
  home_total: number;
  away_total: number;
  first_half_total: number | null;
  second_half_total: number | null;
  q1_moneyline: number | null;
  q1_total: number | null;
  q2_moneyline: number | null;
  q2_total: number | null;
  q3_moneyline: number | null;
  q3_total: number | null;
  q4_moneyline: number | null;
  q4_total: number | null;
  home_q1: number | null;
  home_q2: number | null;
  home_q3: number | null;
  home_q4: number | null;
  visitor_q1: number | null;
  visitor_q2: number | null;
  visitor_q3: number | null;
  visitor_q4: number | null;
};

function dataDir(): string {
  return path.join(process.cwd(), 'data');
}

export function nblPeriodScoresCachePath(year: number): string {
  return path.join(dataDir(), 'nbl-model', 'cache', 'period-scores', `${year}.json`);
}

export function nblSchedulePath(year: number): string {
  return path.join(dataDir(), `nbl-schedule-${year}.json`);
}

export function loadNblScheduleGames(year: number): NblScheduleGame[] {
  const file = nblSchedulePath(year);
  if (!fs.existsSync(file)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { games?: NblScheduleGame[] };
    return Array.isArray(json.games) ? json.games : [];
  } catch {
    return [];
  }
}

export function loadNblPeriodScoreCache(year: number): Record<string, NblPeriodScoreCacheEntry> {
  const file = nblPeriodScoresCachePath(year);
  if (!fs.existsSync(file)) return {};
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      games?: Record<string, NblPeriodScoreCacheEntry>;
    };
    return json.games && typeof json.games === 'object' ? json.games : {};
  } catch {
    return {};
  }
}

export function writeNblPeriodScoreCache(
  year: number,
  games: Record<string, NblPeriodScoreCacheEntry>
) {
  const file = nblPeriodScoresCachePath(year);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        year,
        generatedAt: new Date().toISOString(),
        source: 'embed-api.eui.connect.sportradar.com',
        gameCount: Object.keys(games).length,
        games,
      },
      null,
      2
    )
  );
}

export function nblScheduleGameIsComplete(game: NblScheduleGame): boolean {
  const home = Number(game.homeScore);
  const away = Number(game.awayScore);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return false;
  const status = String(game.status || '').toLowerCase();
  if (status && status !== 'complete' && status !== 'completed' && status !== 'final') {
    // Some snapshots omit status but still have scores.
    if (status === 'scheduled' || status === 'upcoming') return false;
  }
  return true;
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = resolveNblClubName(a) || String(a || '').trim();
  const right = resolveNblClubName(b) || String(b || '').trim();
  if (!left || !right) return false;
  return normalizeTeamKey(left) === normalizeTeamKey(right);
}

function quarterMoneyline(
  teamQ: number | null,
  oppQ: number | null
): number | null {
  if (teamQ == null || oppQ == null) return null;
  if (teamQ === oppQ) return 0;
  return teamQ > oppQ ? 1 : 0;
}

function quarterTotal(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return a + b;
}

export function buildNblTeamGameLogRow(
  game: NblScheduleGame,
  teamName: string,
  year: number,
  periods: NblPeriodScoreCacheEntry | null | undefined
): NblTeamGameLogRow | null {
  if (!nblScheduleGameIsComplete(game)) return null;
  const homeTeam = String(game.homeTeam || '').trim();
  const awayTeam = String(game.awayTeam || '').trim();
  const isHome = teamsMatch(homeTeam, teamName);
  const isAway = teamsMatch(awayTeam, teamName);
  if (!isHome && !isAway) return null;

  const homeScore = Number(game.homeScore);
  const awayScore = Number(game.awayScore);
  const teamScore = isHome ? homeScore : awayScore;
  const oppScore = isHome ? awayScore : homeScore;
  const opponent = isHome ? awayTeam : homeTeam;
  const opponentCode = isHome ? game.awayTeamCode ?? null : game.homeTeamCode ?? null;
  const teamOfficial = resolveNblClubName(teamName) || teamName;
  const result =
    teamScore > oppScore
      ? `W ${teamScore}-${oppScore}`
      : teamScore < oppScore
        ? `L ${teamScore}-${oppScore}`
        : `T ${teamScore}-${oppScore}`;

  const home_q1 = periods?.home_q1 ?? null;
  const home_q2 = periods?.home_q2 ?? null;
  const home_q3 = periods?.home_q3 ?? null;
  const home_q4 = periods?.home_q4 ?? null;
  const visitor_q1 = periods?.visitor_q1 ?? null;
  const visitor_q2 = periods?.visitor_q2 ?? null;
  const visitor_q3 = periods?.visitor_q3 ?? null;
  const visitor_q4 = periods?.visitor_q4 ?? null;
  const hasPeriodScores =
    home_q1 != null &&
    home_q2 != null &&
    home_q3 != null &&
    home_q4 != null &&
    visitor_q1 != null &&
    visitor_q2 != null &&
    visitor_q3 != null &&
    visitor_q4 != null;

  const teamQ1 = isHome ? home_q1 : visitor_q1;
  const oppQ1 = isHome ? visitor_q1 : home_q1;
  const teamQ2 = isHome ? home_q2 : visitor_q2;
  const oppQ2 = isHome ? visitor_q2 : home_q2;
  const teamQ3 = isHome ? home_q3 : visitor_q3;
  const oppQ3 = isHome ? visitor_q3 : home_q3;
  const teamQ4 = isHome ? home_q4 : visitor_q4;
  const oppQ4 = isHome ? visitor_q4 : home_q4;

  return {
    matchId: String(game.id || game.externalId || ''),
    date: game.startTime ?? null,
    season: year,
    round: game.round ?? null,
    opponent,
    opponentCode,
    isHome,
    team: teamOfficial,
    teamCode: isHome ? game.homeTeamCode ?? null : game.awayTeamCode ?? null,
    result,
    venue: game.venue ?? null,
    teamScore,
    oppScore,
    homeScore,
    awayScore,
    hasPeriodScores,
    moneyline: teamScore > oppScore ? 1 : 0,
    // NBA Game Props: positive = team lost (failed to cover), negative = team won.
    spread: oppScore - teamScore,
    total_pts: homeScore + awayScore,
    home_total: homeScore,
    away_total: awayScore,
    first_half_total: quarterTotal(
      quarterTotal(home_q1, home_q2),
      quarterTotal(visitor_q1, visitor_q2)
    ),
    second_half_total: quarterTotal(
      quarterTotal(home_q3, home_q4),
      quarterTotal(visitor_q3, visitor_q4)
    ),
    q1_moneyline: quarterMoneyline(teamQ1, oppQ1),
    q1_total: quarterTotal(home_q1, visitor_q1),
    q2_moneyline: quarterMoneyline(teamQ2, oppQ2),
    q2_total: quarterTotal(home_q2, visitor_q2),
    q3_moneyline: quarterMoneyline(teamQ3, oppQ3),
    q3_total: quarterTotal(home_q3, visitor_q3),
    q4_moneyline: quarterMoneyline(teamQ4, oppQ4),
    q4_total: quarterTotal(home_q4, visitor_q4),
    home_q1,
    home_q2,
    home_q3,
    home_q4,
    visitor_q1,
    visitor_q2,
    visitor_q3,
    visitor_q4,
  };
}

export function buildNblTeamGameLogs(
  teamName: string,
  years: readonly number[] = NBL_CHART_HISTORY_YEARS
): NblTeamGameLogRow[] {
  const official = resolveNblClubName(teamName) || String(teamName || '').trim();
  if (!official) return [];

  const rows: NblTeamGameLogRow[] = [];
  for (const year of years) {
    const schedule = loadNblScheduleGames(year);
    if (!schedule.length) continue;
    const periods = loadNblPeriodScoreCache(year);
    for (const game of schedule) {
      const matchId = String(game.id || game.externalId || '').trim();
      const row = buildNblTeamGameLogRow(game, official, year, matchId ? periods[matchId] : null);
      if (row) rows.push(row);
    }
  }

  rows.sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    const aDate = new Date(a.date || 0).getTime();
    const bDate = new Date(b.date || 0).getTime();
    if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return aDate - bDate;
    return 0;
  });
  return rows;
}

export function completedNblScheduleGames(
  years: readonly number[] = NBL_CHART_HISTORY_YEARS
): Array<{ year: number; game: NblScheduleGame }> {
  const out: Array<{ year: number; game: NblScheduleGame }> = [];
  for (const year of years) {
    for (const game of loadNblScheduleGames(year)) {
      if (nblScheduleGameIsComplete(game)) out.push({ year, game });
    }
  }
  return out;
}
