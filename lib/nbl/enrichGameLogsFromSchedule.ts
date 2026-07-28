import fs from 'fs';
import path from 'path';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';

type ScheduleGame = {
  id?: string;
  externalId?: string | null;
  startTime?: string | null;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  venue?: string | null;
};

function dayKey(value: string | null | undefined): string {
  return String(value || '').slice(0, 10);
}

function loadScheduleGames(year: number): ScheduleGame[] {
  const file = path.join(process.cwd(), 'data', `nbl-schedule-${year}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { games?: ScheduleGame[] };
    return Array.isArray(json.games) ? json.games : [];
  } catch {
    return [];
  }
}

function findScheduleMatch(game: NblGameLogRow, schedule: ScheduleGame[]): ScheduleGame | null {
  const byId = schedule.find((s) => s.id === game.matchId || s.externalId === game.matchId);
  if (byId) return byId;

  const day = dayKey(game.date);
  if (!day) return null;
  const cands = schedule.filter((s) => dayKey(s.startTime) === day);
  return (
    cands.find(
      (s) =>
        (s.homeTeam === game.team && s.awayTeam === game.opponent) ||
        (s.awayTeam === game.team && s.homeTeam === game.opponent) ||
        (s.homeTeamCode === game.teamCode &&
          (s.awayTeam === game.opponent || s.awayTeamCode === game.opponentCode)) ||
        (s.awayTeamCode === game.teamCode &&
          (s.homeTeam === game.opponent || s.homeTeamCode === game.opponentCode))
    ) ?? null
  );
}

/** Fill result/venue from schedule snapshot when Rosetta boxscores omit scores. */
export function enrichGameLogsFromSchedule(
  games: NblGameLogRow[],
  year: number = NBL_CURRENT_SEASON_YEAR
): NblGameLogRow[] {
  if (!games.length) return games;
  const schedule = loadScheduleGames(year);
  if (!schedule.length) return games;

  return games.map((game) => {
    if (game.result && game.venue) return game;
    const match = findScheduleMatch(game, schedule);
    if (!match) return game;

    let result = game.result;
    if (
      !result &&
      match.homeScore != null &&
      match.awayScore != null &&
      Number.isFinite(match.homeScore) &&
      Number.isFinite(match.awayScore)
    ) {
      const teamScore = game.isHome ? match.homeScore : match.awayScore;
      const oppScore = game.isHome ? match.awayScore : match.homeScore;
      result =
        teamScore > oppScore
          ? `W ${teamScore}-${oppScore}`
          : teamScore < oppScore
            ? `L ${teamScore}-${oppScore}`
            : `T ${teamScore}-${oppScore}`;
    }

    const venue = game.venue || (match.venue ? String(match.venue) : null);
    if (result === game.result && venue === game.venue) return game;
    return { ...game, result, venue };
  });
}
