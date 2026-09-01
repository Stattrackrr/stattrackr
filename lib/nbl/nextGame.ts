/**
 * Resolve a team's next NBL tipoff from Rosetta next-matches / schedule snapshots.
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_CLUBS,
  NBL_CURRENT_SEASON_YEAR,
  normalizeTeamKey,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';

export type NblNextGame = {
  team: string;
  teamCode: string | null;
  opponent: string;
  opponentCode: string | null;
  opponentLogo: string | null;
  tipoff: string;
  matchId: string | null;
  venue: string | null;
  isHome: boolean;
  homeTeam: string;
  awayTeam: string;
  year: number;
  source: 'next-matches' | 'schedule';
};

type NextMatchEntry = {
  id?: string;
  start_time_datetime?: string | null;
  is_home?: boolean | null;
  opponent_id?: string | null;
  opponent_name?: string | null;
  opponent_logo?: string | null;
  venue?: string | null;
  match_slug?: string | null;
};

type NextMatchesTeamRow = {
  id?: string;
  name?: string;
  team_code?: string | null;
  nextMatches?: NextMatchEntry[];
};

type ScheduleGame = {
  id?: string;
  startTime?: string | null;
  status?: string | null;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
  venue?: string | null;
};

function teamKeys(input: string): string[] {
  const raw = String(input || '').trim();
  if (!raw) return [];
  const keys = new Set<string>();
  keys.add(normalizeTeamKey(raw));
  const resolved = resolveNblClubName(raw);
  if (resolved) keys.add(normalizeTeamKey(resolved));
  return [...keys].filter(Boolean);
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const aKeys = teamKeys(a);
  const bKeys = teamKeys(b);
  return aKeys.some((k) => bKeys.includes(k));
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function fromNextMatchesSnapshot(
  team: string,
  year: number,
  nowMs: number
): NblNextGame | null {
  const file = path.join(process.cwd(), 'data', `nbl-next-matches-${year}.json`);
  const payload = readJsonFile<{ teams?: NextMatchesTeamRow[] }>(file);
  const teams = Array.isArray(payload?.teams) ? payload!.teams! : [];
  const row = teams.find((t) => teamsMatch(t.name, team) || teamsMatch(t.team_code || '', team));
  if (!row?.nextMatches?.length) return null;

  const upcoming = [...row.nextMatches]
    .filter((m) => m.start_time_datetime && Date.parse(String(m.start_time_datetime)) >= nowMs)
    .sort(
      (a, b) =>
        Date.parse(String(a.start_time_datetime)) - Date.parse(String(b.start_time_datetime))
    );
  const match = upcoming[0] ?? null;
  if (!match?.start_time_datetime || !match.opponent_name) return null;

  const teamName = resolveNblClubName(row.name || team) || row.name || team;
  const opponent = resolveNblClubName(match.opponent_name) || match.opponent_name;
  const isHome = Boolean(match.is_home);
  return {
    team: teamName,
    teamCode: row.team_code ?? null,
    opponent,
    opponentCode: null,
    opponentLogo: match.opponent_logo ? String(match.opponent_logo) : null,
    tipoff: String(match.start_time_datetime),
    matchId: match.id ?? null,
    venue: match.venue ? String(match.venue) : null,
    isHome,
    homeTeam: isHome ? teamName : opponent,
    awayTeam: isHome ? opponent : teamName,
    year,
    source: 'next-matches',
  };
}

function fromScheduleSnapshot(team: string, year: number, nowMs: number): NblNextGame | null {
  const file = path.join(process.cwd(), 'data', `nbl-schedule-${year}.json`);
  const payload = readJsonFile<{ games?: ScheduleGame[] }>(file);
  const games = Array.isArray(payload?.games) ? payload!.games! : [];
  const matching = games.filter(
    (g) => teamsMatch(g.homeTeam, team) || teamsMatch(g.awayTeam, team)
  );
  if (!matching.length) return null;

  matching.sort(
    (a, b) => Date.parse(String(a.startTime || 0)) - Date.parse(String(b.startTime || 0))
  );
  const nextUpcoming = matching.find((g) => {
    const t = Date.parse(String(g.startTime || 0));
    if (!Number.isFinite(t) || t < nowMs) return false;
    const status = String(g.status || '').toLowerCase();
    return status !== 'complete' && status !== 'completed' && status !== 'final';
  });
  const game = nextUpcoming ?? null;
  if (!game?.startTime) return null;

  const isHome = teamsMatch(game.homeTeam, team);
  const teamName =
    resolveNblClubName((isHome ? game.homeTeam : game.awayTeam) || team) ||
    (isHome ? game.homeTeam : game.awayTeam) ||
    team;
  const opponentRaw = isHome ? game.awayTeam : game.homeTeam;
  const opponent = resolveNblClubName(opponentRaw || '') || opponentRaw || '—';
  return {
    team: teamName,
    teamCode: (isHome ? game.homeTeamCode : game.awayTeamCode) ?? null,
    opponent,
    opponentCode: (isHome ? game.awayTeamCode : game.homeTeamCode) ?? null,
    opponentLogo: (isHome ? game.awayLogo : game.homeLogo) ?? null,
    tipoff: String(game.startTime),
    matchId: game.id ?? null,
    venue: game.venue ?? null,
    isHome,
    homeTeam: resolveNblClubName(game.homeTeam || '') || game.homeTeam || '',
    awayTeam: resolveNblClubName(game.awayTeam || '') || game.awayTeam || '',
    year,
    source: 'schedule',
  };
}

/** Next upcoming tipoff for a club in the given Rosetta season year. */
export function getNblNextGameForTeam(
  team: string,
  year: number = NBL_CURRENT_SEASON_YEAR,
  nowMs: number = Date.now()
): NblNextGame | null {
  const trimmed = String(team || '').trim();
  if (!trimmed) return null;
  return (
    fromNextMatchesSnapshot(trimmed, year, nowMs) ||
    fromScheduleSnapshot(trimmed, year, nowMs)
  );
}

export type NblUpcomingRoundGame = {
  matchId: string | null;
  tipoff: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
};

function clubCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = normalizeTeamKey(name);
  const club = NBL_CLUBS.find(
    (c) =>
      normalizeTeamKey(c.name) === key ||
      normalizeTeamKey(c.shortName) === key ||
      c.code.toLowerCase() === key
  );
  return club?.code ?? null;
}

const ROUND_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

/** Unique upcoming fixtures in the next NBL round (clustered from each club's next tip). */
export function listNblUpcomingRoundGames(
  year: number = NBL_CURRENT_SEASON_YEAR,
  nowMs: number = Date.now()
): NblUpcomingRoundGame[] {
  const byKey = new Map<string, NblUpcomingRoundGame>();
  for (const club of NBL_CLUBS) {
    const next = getNblNextGameForTeam(club.name, year, nowMs);
    if (!next?.tipoff) continue;
    const home = next.homeTeam || (next.isHome ? next.team : next.opponent);
    const away = next.awayTeam || (next.isHome ? next.opponent : next.team);
    const key =
      next.matchId ||
      [normalizeTeamKey(home), normalizeTeamKey(away)].filter(Boolean).sort().join('|');
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      matchId: next.matchId,
      tipoff: next.tipoff,
      homeTeam: home,
      awayTeam: away,
      homeTeamCode: next.isHome
        ? next.teamCode || clubCodeFromName(home)
        : next.opponentCode || clubCodeFromName(home),
      awayTeamCode: next.isHome
        ? next.opponentCode || clubCodeFromName(away)
        : next.teamCode || clubCodeFromName(away),
    });
  }

  const games = [...byKey.values()].sort(
    (a, b) => Date.parse(a.tipoff) - Date.parse(b.tipoff)
  );
  if (!games.length) return [];
  const start = Date.parse(games[0].tipoff);
  if (!Number.isFinite(start)) return games;
  return games.filter((game) => {
    const t = Date.parse(game.tipoff);
    return Number.isFinite(t) && t - start <= ROUND_WINDOW_MS;
  });
}
