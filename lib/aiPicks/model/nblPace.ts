/**
 * Team pace and ratings from every game both teams played (this season and last), weighted toward
 * recent games, and the pace expected in a coming game. Pure: the scan supplies the team-game rows.
 */

import { round } from '@/lib/aiPicks/model/math';
import { nblTeamKey } from '@/lib/aiPicks/model/nblGames';
import type { NblTeamGame } from '@/lib/nbl/teamGames';

export type NblPaceProfile = {
  team: string;
  /** Possessions per 40 minutes, recent games weighted up, shrunk toward the league. */
  pace: number;
  offRtg: number;
  defRtg: number;
  last5: number | null;
  home: { pace: number; n: number } | null;
  away: { pace: number; n: number } | null;
  /** Games behind the numbers, this season and last. */
  games: number;
  seasonGames: number;
};

export type NblPaceTable = {
  teams: Map<string, NblPaceProfile>;
  leaguePace: number | null;
  leagueRtg: number | null;
  /** Pace of every game in the table, by match id. */
  byMatch: Map<string, number>;
  rows: NblTeamGame[];
};

const HALF_LIFE_GAMES = 10;
const PRIOR_SEASON_WEIGHT = 0.4;
/** Pace settles fast; ratings need more games. */
const PACE_PRIOR_GAMES = 3;
const RATING_PRIOR_GAMES = 5;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function nblPaceTable(allRows: NblTeamGame[], season: number, beforeMs: number): NblPaceTable {
  const rows = allRows.filter((r) => r.season >= season - 1 && r.season <= season && Date.parse(r.date) < beforeMs);
  const seasonW = (r: NblTeamGame) => (r.season === season ? 1 : PRIOR_SEASON_WEIGHT);
  let lw = 0;
  let lPace = 0;
  let lPts = 0;
  let lPoss = 0;
  for (const r of rows) {
    const w = seasonW(r);
    lw += w;
    lPace += w * r.pace;
    lPts += w * r.pts;
    lPoss += w * r.poss;
  }
  const leaguePace = lw > 0 ? lPace / lw : null;
  const leagueRtg = lPoss > 0 ? (100 * lPts) / lPoss : null;

  const byTeam = new Map<string, NblTeamGame[]>();
  for (const r of rows) {
    const k = nblTeamKey(r.team);
    byTeam.set(k, [...(byTeam.get(k) ?? []), r]);
  }
  const teams = new Map<string, NblPaceProfile>();
  if (leaguePace != null && leagueRtg != null) {
    for (const [key, list] of byTeam) {
      const recentFirst = [...list].sort((a, b) => b.date.localeCompare(a.date));
      let w = 0;
      let pace = 0;
      let off = 0;
      let def = 0;
      const split = { home: { w: 0, pace: 0, n: 0 }, away: { w: 0, pace: 0, n: 0 } };
      recentFirst.forEach((r, i) => {
        const wi = 0.5 ** (i / HALF_LIFE_GAMES) * seasonW(r);
        w += wi;
        pace += wi * r.pace;
        off += wi * ((100 * r.pts) / r.poss);
        def += wi * ((100 * r.oppPts) / r.oppPoss);
        if (r.isHome != null) {
          const s = r.isHome ? split.home : split.away;
          s.w += wi;
          s.pace += wi * r.pace;
          s.n += 1;
        }
      });
      const side = (s: { w: number; pace: number; n: number }) => (s.w > 0 ? { pace: round(s.pace / s.w, 2), n: s.n } : null);
      teams.set(key, {
        team: list[0]!.team,
        pace: round((pace + PACE_PRIOR_GAMES * leaguePace) / (w + PACE_PRIOR_GAMES), 2),
        offRtg: round((off + RATING_PRIOR_GAMES * leagueRtg) / (w + RATING_PRIOR_GAMES), 1),
        defRtg: round((def + RATING_PRIOR_GAMES * leagueRtg) / (w + RATING_PRIOR_GAMES), 1),
        last5: (() => {
          const m = mean(recentFirst.slice(0, 5).map((r) => r.pace));
          return m == null ? null : round(m, 1);
        })(),
        home: side(split.home),
        away: side(split.away),
        games: list.length,
        seasonGames: list.filter((r) => r.season === season).length,
      });
    }
  }
  const byMatch = new Map<string, number>();
  for (const r of allRows) if (!byMatch.has(r.matchId)) byMatch.set(r.matchId, r.pace);
  return { teams, leaguePace, leagueRtg, byMatch, rows };
}

export function paceProfile(table: NblPaceTable, team: string): NblPaceProfile | null {
  return table.teams.get(nblTeamKey(team)) ?? null;
}

export type NblExpectedPace = {
  pace: number;
  /** Their meetings this season and last: shown, not used (it did not predict better). */
  h2h: { n: number; pace: number } | null;
  notes: string[];
};

/**
 * Both teams' pace against the league: a fast team lifts the game above the league by its own margin.
 * Home/away pace and past meetings were tested on three seasons and made it worse, so they are only shown.
 */
export function expectedNblGamePace(table: NblPaceTable, homeTeam: string, awayTeam: string): NblExpectedPace | null {
  const h = paceProfile(table, homeTeam);
  const a = paceProfile(table, awayTeam);
  const lg = table.leaguePace;
  if (!h || !a || lg == null) return null;
  const pace = h.pace + a.pace - lg;
  const notes = [`${h.team} pace ${round(h.pace, 1)} (last 5: ${h.last5 ?? '-'}), ${a.team} ${round(a.pace, 1)} (last 5: ${a.last5 ?? '-'}), league ${round(lg, 1)}`];
  const hk = nblTeamKey(homeTeam);
  const ak = nblTeamKey(awayTeam);
  const meetings = table.rows.filter((r) => nblTeamKey(r.team) === hk && nblTeamKey(r.opponent) === ak);
  const m = mean(meetings.map((r) => r.pace));
  const h2h = m != null ? { n: meetings.length, pace: round(m, 1) } : null;
  if (h2h) notes.push(`${h2h.n} recent meeting${h2h.n === 1 ? '' : 's'} averaged ${h2h.pace}`);
  return { pace: round(pace, 2), h2h, notes };
}
