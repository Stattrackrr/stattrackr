/**
 * Resolve real NBL starters/bench for a team (and optional opponent)
 * from the most recent completed SportRadar box score.
 */

import fs from 'fs';
import path from 'path';
import {
  NBL_CURRENT_SEASON_YEAR,
  NBL_CHART_HISTORY_YEARS,
  normalizeTeamKey,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';
import {
  fetchNblMatchLineupsFromSportRadar,
  type NblMatchLineups,
  type NblTeamLineupFromMatch,
} from '@/lib/nbl/sportRadarLineups';

type ScheduleGame = {
  id?: string;
  externalId?: string | null;
  startTime?: string | null;
  status?: string | null;
  homeTeam?: string;
  awayTeam?: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  matchSlug?: string | null;
};

export type NblTeamRealLineup = {
  team: string;
  lineup: {
    starters: Array<{
      playerId: string | null;
      name: string;
      jersey: string | null;
      position: string | null;
      positionLabel: string;
      slot: string;
      imageUrl: string | null;
    }>;
    bench: Array<{
      playerId: string | null;
      name: string;
      jersey: string | null;
      position: string | null;
      imageUrl: string | null;
    }>;
  };
  match: {
    fixtureId: string;
    opponent: string;
    isHome: boolean;
    tipoff: string | null;
    homeTeam: string;
    awayTeam: string;
    homeScore: string | null;
    awayScore: string | null;
    matchSlug: string | null;
    year: number;
  } | null;
};

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ca = resolveNblClubName(a);
  const cb = resolveNblClubName(b);
  if (ca && cb && normalizeTeamKey(ca) === normalizeTeamKey(cb)) return true;
  return normalizeTeamKey(a) === normalizeTeamKey(b);
}

function isComplete(status: string | null | undefined): boolean {
  return /complete|final|played/i.test(String(status || ''));
}

function fixtureIdForGame(game: ScheduleGame): string | null {
  const ext = String(game.externalId || '').trim();
  if (ext) return ext;
  const id = String(game.id || '').trim();
  return id || null;
}

function loadCompletedGames(years: number[]): Array<ScheduleGame & { year: number }> {
  const out: Array<ScheduleGame & { year: number }> = [];
  for (const year of years) {
    const payload = readJson<{ games?: ScheduleGame[] }>(
      path.join(process.cwd(), 'data', `nbl-schedule-${year}.json`)
    );
    for (const g of payload?.games || []) {
      if (!isComplete(g.status)) continue;
      if (!fixtureIdForGame(g)) continue;
      out.push({ ...g, year });
    }
  }
  out.sort((a, b) => String(b.startTime || '').localeCompare(String(a.startTime || '')));
  return out;
}

function pickTeamSide(
  match: NblMatchLineups,
  team: string
): NblTeamLineupFromMatch | null {
  return (
    match.teams.find((t) => teamsMatch(t.team, team) || teamsMatch(t.teamCode, team)) || null
  );
}

function toCardLineup(side: NblTeamLineupFromMatch) {
  return {
    starters: side.starters.map((p) => ({
      playerId: p.personId,
      name: p.name,
      jersey: p.jersey,
      position: p.position,
      positionLabel: String(p.position || '–').toUpperCase(),
      slot: String(p.position || '–').toUpperCase(),
      imageUrl: p.imageUrl,
    })),
    bench: side.bench.map((p) => ({
      playerId: p.personId,
      name: p.name,
      jersey: p.jersey,
      position: p.position,
      imageUrl: p.imageUrl,
    })),
  };
}

function sideToCard(
  side: NblTeamLineupFromMatch,
  match: NblMatchLineups,
  game: ScheduleGame & { year: number }
): NblTeamRealLineup {
  const opponent = side.isHome ? match.awayTeam : match.homeTeam;
  return {
    team: side.team,
    lineup: toCardLineup(side),
    match: {
      fixtureId: match.fixtureId,
      opponent,
      isHome: side.isHome,
      tipoff: match.tipoff || game.startTime || null,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      matchSlug: game.matchSlug || null,
      year: game.year,
    },
  };
}

/**
 * Most recent completed game for the selected team.
 * Returns both sides from that fixture (for a team selector + starters/bench UI).
 */
export async function buildRealLineups(options: {
  team: string;
  opponent?: string | null;
  year?: number;
}): Promise<{
  team: NblTeamRealLineup | null;
  opponent: NblTeamRealLineup | null;
  sharedMatch: boolean;
}> {
  const team = resolveNblClubName(options.team) || options.team.trim();
  const year = options.year ?? NBL_CURRENT_SEASON_YEAR;

  const years = [
    year,
    ...NBL_CHART_HISTORY_YEARS.filter((y) => y !== year),
  ];
  const games = loadCompletedGames(years);

  const teamGame = games.find(
    (g) => teamsMatch(g.homeTeam, team) || teamsMatch(g.awayTeam, team)
  );
  if (!teamGame) {
    return { sharedMatch: false, team: null, opponent: null };
  }

  const fixtureId = fixtureIdForGame(teamGame);
  if (!fixtureId) {
    return { sharedMatch: false, team: null, opponent: null };
  }

  const match = await fetchNblMatchLineupsFromSportRadar(fixtureId);
  if (!match) {
    return { sharedMatch: false, team: null, opponent: null };
  }

  const teamSide = pickTeamSide(match, team);
  if (!teamSide?.starters.length) {
    return { sharedMatch: false, team: null, opponent: null };
  }

  const oppName = teamSide.isHome ? match.awayTeam : match.homeTeam;
  const oppSide = pickTeamSide(match, oppName);

  return {
    sharedMatch: true,
    team: sideToCard(teamSide, match, teamGame),
    opponent:
      oppSide && oppSide.starters.length > 0
        ? sideToCard(oppSide, match, teamGame)
        : null,
  };
}
