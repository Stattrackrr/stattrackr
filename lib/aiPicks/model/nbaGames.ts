/**
 * NBA game lines from team box scores: recency-weighted offensive and defensive ratings per 100
 * possessions and pace, shrunk to the league, plus home court. Margin and total are treated as normal.
 */

import { normalCdf, normalSideProbs, round, type SideProbs } from '@/lib/aiPicks/model/math';
import type { NbaSeasonDataset, NbaTeamGameTotals } from '@/lib/nba/dash/season';
import { normalizeTeamKey, resolveNbaClub } from '@/lib/nba/dash/teams';

/** One finished game. Possessions are each team's own estimate (FGA + 0.44 FTA - OREB + TOV). */
export type NbaFinal = {
  matchId: string;
  date: string;
  season: number;
  postseason: boolean;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  homePoss: number;
  awayPoss: number;
  /** Game length in minutes (48, or more with overtime). */
  minutes: number;
};

export type NbaTeamRating = {
  team: string;
  offRtg: number;
  defRtg: number;
  /** Possessions per 48. */
  pace: number;
  games: number;
};

export type NbaGameProjection = {
  homeMargin: number;
  total: number;
  marginSd: number;
  totalSd: number;
  pace: number;
  home: NbaTeamRating | null;
  away: NbaTeamRating | null;
  league: { rtg: number; pace: number };
};

export type NbaGameModelOptions = {
  homeCourt: number;
  halfLifeGames: number;
  priorSeasonWeight: number;
  shrinkGames: number;
  /** Points per game the possession estimate misses (overtime, possession formula). */
  totalAllowance: number;
  marginSd: number;
  totalSd: number;
};

/**
 * Fitted on the 2024-25 and 2025-26 regular seasons, each game predicted from earlier games only:
 * home court 1.7, totals 2 points short without the allowance, error SD 14.2 (margin) and 18.7 (total).
 * The points-for/against model scored the same; this one also gives pace.
 */
export const NBA_GAME_MODEL: NbaGameModelOptions = {
  homeCourt: 1.7,
  halfLifeGames: 20,
  priorSeasonWeight: 0.25,
  shrinkGames: 4,
  totalAllowance: 2,
  marginSd: 14.2,
  totalSd: 18.7,
};

export const nbaTeamKey = (name: string | null | undefined) => resolveNbaClub(name)?.code ?? normalizeTeamKey(String(name || ''));

export function nbaPossessions(t: { fga: number; fta: number; oreb: number; tov: number }): number {
  return t.fga + 0.44 * t.fta - t.oreb + t.tov;
}

/** Finished games from the season dataset's team box totals, home side from the player rows. */
export function nbaFinalsFromDataset(ds: NbaSeasonDataset): NbaFinal[] {
  const homeOf = new Map<string, string>();
  for (const logs of ds.logsByPlayer.values()) {
    for (const g of logs) if (g.isHome && g.teamCode && !homeOf.has(g.matchId)) homeOf.set(g.matchId, g.teamCode);
  }
  const byMatch = new Map<string, NbaTeamGameTotals[]>();
  for (const t of ds.teamGames.values()) byMatch.set(t.matchId, [...(byMatch.get(t.matchId) ?? []), t]);
  const out: NbaFinal[] = [];
  for (const [matchId, sides] of byMatch) {
    if (sides.length !== 2) continue;
    const homeCode = homeOf.get(matchId);
    const h = sides.find((s) => s.teamCode === homeCode);
    const a = sides.find((s) => s.teamCode !== homeCode);
    if (!h || !a || !(h.pts > 0) || !(a.pts > 0)) continue;
    out.push({
      matchId,
      date: h.date,
      season: ds.season,
      postseason: h.postseason,
      home: h.teamCode,
      away: a.teamCode,
      homeScore: h.pts,
      awayScore: a.pts,
      homePoss: nbaPossessions(h),
      awayPoss: nbaPossessions(a),
      minutes: Math.max(48, Math.round(h.minutes / 5)),
    });
  }
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

export function nbaTeamRatings(
  finals: NbaFinal[],
  currentSeason: number,
  opts: NbaGameModelOptions = NBA_GAME_MODEL
): { ratings: Map<string, NbaTeamRating>; league: { rtg: number; pace: number } } {
  const ordered = finals.filter((g) => g.season >= currentSeason - 1).sort((a, b) => a.date.localeCompare(b.date));
  type Acc = { team: string; pts: number; poss: number; oppPts: number; oppPoss: number; pace: number; w: number; games: number; back: number };
  const acc = new Map<string, Acc>();
  let lgPts = 0;
  let lgPoss = 0;
  let lgPace = 0;
  let lgW = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const g = ordered[i]!;
    const seasonW = g.season === currentSeason ? 1 : opts.priorSeasonWeight;
    const gamePace = ((g.homePoss + g.awayPoss) / 2) * (48 / g.minutes);
    for (const [team, pts, poss, oppPts, oppPoss] of [
      [g.home, g.homeScore, g.homePoss, g.awayScore, g.awayPoss],
      [g.away, g.awayScore, g.awayPoss, g.homeScore, g.homePoss],
    ] as const) {
      const row = acc.get(team) ?? { team, pts: 0, poss: 0, oppPts: 0, oppPoss: 0, pace: 0, w: 0, games: 0, back: 0 };
      const w = seasonW * Math.pow(0.5, row.back / opts.halfLifeGames);
      row.pts += w * pts;
      row.poss += w * poss;
      row.oppPts += w * oppPts;
      row.oppPoss += w * oppPoss;
      row.pace += w * gamePace;
      row.w += w;
      row.games += 1;
      row.back += 1;
      acc.set(team, row);
      lgPts += w * pts;
      lgPoss += w * poss;
      lgPace += w * gamePace;
      lgW += w;
    }
  }
  const league = { rtg: lgPoss > 0 ? (100 * lgPts) / lgPoss : 114, pace: lgW > 0 ? lgPace / lgW : 99 };
  const ratings = new Map<string, NbaTeamRating>();
  for (const [key, r] of acc) {
    const shrink = r.w / (r.w + opts.shrinkGames);
    ratings.set(key, {
      team: r.team,
      offRtg: round(league.rtg + ((100 * r.pts) / r.poss - league.rtg) * shrink, 2),
      defRtg: round(league.rtg + ((100 * r.oppPts) / r.oppPoss - league.rtg) * shrink, 2),
      pace: round(league.pace + (r.pace / r.w - league.pace) * shrink, 2),
      games: r.games,
    });
  }
  return { ratings, league: { rtg: round(league.rtg, 2), pace: round(league.pace, 2) } };
}

export function projectNbaGame(
  home: string,
  away: string,
  rated: ReturnType<typeof nbaTeamRatings>,
  opts: NbaGameModelOptions = NBA_GAME_MODEL
): NbaGameProjection {
  const { ratings, league } = rated;
  const h = ratings.get(nbaTeamKey(home)) ?? null;
  const a = ratings.get(nbaTeamKey(away)) ?? null;
  const pace = league.pace + ((h?.pace ?? league.pace) - league.pace) + ((a?.pace ?? league.pace) - league.pace);
  const homeRtg = league.rtg + ((h?.offRtg ?? league.rtg) - league.rtg) + ((a?.defRtg ?? league.rtg) - league.rtg);
  const awayRtg = league.rtg + ((a?.offRtg ?? league.rtg) - league.rtg) + ((h?.defRtg ?? league.rtg) - league.rtg);
  const homePts = (pace * homeRtg) / 100 + opts.homeCourt / 2 + opts.totalAllowance / 2;
  const awayPts = (pace * awayRtg) / 100 - opts.homeCourt / 2 + opts.totalAllowance / 2;
  return {
    homeMargin: round(homePts - awayPts, 2),
    total: round(homePts + awayPts, 1),
    marginSd: opts.marginSd,
    totalSd: opts.totalSd,
    pace: round(pace, 1),
    home: h,
    away: a,
    league,
  };
}

/** What a side's missing regulars (played 3 of the last 5, 20+ minutes) did a game over their last 40. */
export type NbaMissing = { players: string[]; points: number; gameScore: number; minutes: number };

export type NbaGameContext = {
  homeMissing: NbaMissing;
  awayMissing: NbaMissing;
  homeRestDays: number | null;
  awayRestDays: number | null;
  /** 1 = as built, 0 = ratings model only. */
  strength: number;
};

/**
 * Backtest: a back to back cost the tired side about 2.5 points of margin with the total unchanged.
 * Missing players, fitted on one season and tested on the other: game score beat points for the
 * margin, and game score plus minutes beat everything for the total (a star out lowers it, a role
 * player's minutes going to the bench raise it). Plus-minus and on/off added nothing.
 */
export const NBA_BACK_TO_BACK_MARGIN = 2.5;
export const NBA_INJURY = { marginPerGameScore: 0.156, totalPerGameScore: -0.405, totalPerMinute: 0.156 };

/** Game score (Hollinger): one number for a box score line. */
export function nbaGameScore(g: {
  points?: number | null;
  fgMade?: number | null;
  fgAttempted?: number | null;
  ftMade?: number | null;
  ftAttempted?: number | null;
  offensiveRebounds?: number | null;
  defensiveRebounds?: number | null;
  steals?: number | null;
  assists?: number | null;
  blocks?: number | null;
  fouls?: number | null;
  turnovers?: number | null;
}): number {
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return (
    n(g.points) + 0.4 * n(g.fgMade) - 0.7 * n(g.fgAttempted) - 0.4 * (n(g.ftAttempted) - n(g.ftMade)) + 0.7 * n(g.offensiveRebounds) +
    0.3 * n(g.defensiveRebounds) + n(g.steals) + 0.7 * n(g.assists) + 0.7 * n(g.blocks) - 0.4 * n(g.fouls) - n(g.turnovers)
  );
}

/** Margin and total change when these players sit, from the side that loses them. */
export function nbaMissingEffect(m: Pick<NbaMissing, 'gameScore' | 'minutes'>): { margin: number; total: number } {
  return {
    margin: -NBA_INJURY.marginPerGameScore * Math.max(0, m.gameScore),
    total: NBA_INJURY.totalPerGameScore * Math.max(0, m.gameScore) + NBA_INJURY.totalPerMinute * Math.max(0, m.minutes),
  };
}

/** Ratings model, then injuries and back to backs. */
export function adjustNbaGame(p: NbaGameProjection, ctx: NbaGameContext): NbaGameProjection & { notes: string[] } {
  let homePts = (p.total + p.homeMargin) / 2;
  let awayPts = (p.total - p.homeMargin) / 2;
  const notes: string[] = [`Expected pace ${p.pace} possessions (league ${round(p.league.pace, 1)})`];
  for (const [side, m] of [['home', ctx.homeMissing], ['away', ctx.awayMissing]] as const) {
    if (!m.players.length) continue;
    const e = nbaMissingEffect(m);
    const own = (e.total + e.margin) / 2;
    const opp = (e.total - e.margin) / 2;
    if (side === 'home') {
      homePts += own;
      awayPts += opp;
    } else {
      awayPts += own;
      homePts += opp;
    }
    notes.push(
      `${side === 'home' ? 'Home' : 'Away'} missing ${m.players.join(', ')} (${round(m.points, 1)} pts, game score ${round(m.gameScore, 1)}, ${round(m.minutes)} min a game between them)`
    );
  }
  const homeB2b = ctx.homeRestDays != null && ctx.homeRestDays <= 1;
  const awayB2b = ctx.awayRestDays != null && ctx.awayRestDays <= 1;
  if (homeB2b !== awayB2b) {
    const shift = (homeB2b ? -1 : 1) * (NBA_BACK_TO_BACK_MARGIN / 2);
    homePts += shift;
    awayPts -= shift;
    notes.push(homeB2b ? 'Home on a back to back' : 'Away on a back to back');
  }
  const s = ctx.strength;
  return {
    ...p,
    homeMargin: round(p.homeMargin + s * (homePts - awayPts - p.homeMargin), 2),
    total: round(p.total + s * (homePts + awayPts - p.total), 1),
    notes,
  };
}

export function nbaH2hProb(p: Pick<NbaGameProjection, 'homeMargin' | 'marginSd'>, side: 'home' | 'away'): number {
  const home = 1 - normalCdf(-p.homeMargin / p.marginSd);
  return side === 'home' ? home : 1 - home;
}

/** Selected side covers `line` (its own handicap). Over = covers. */
export function nbaSpreadProbs(p: Pick<NbaGameProjection, 'homeMargin' | 'marginSd'>, side: 'home' | 'away', line: number): SideProbs {
  const margin = side === 'home' ? p.homeMargin : -p.homeMargin;
  return normalSideProbs(margin, p.marginSd, -line);
}

export function nbaTotalProbs(p: Pick<NbaGameProjection, 'total' | 'totalSd'>, line: number): SideProbs {
  return normalSideProbs(p.total, p.totalSd, line);
}
