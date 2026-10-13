/**
 * NBL game lines from team scoring: recency-weighted points for/against, shrunk to the league
 * average, plus home court. Margin and total are treated as normal.
 */

import { normalCdf, normalSideProbs, round, type SideProbs } from '@/lib/aiPicks/model/math';
import { normalizeTeamKey, resolveNblClubName } from '@/lib/nblTeamCanonical';

export type NblFinal = { date: string; season: number; home: string; away: string; homeScore: number; awayScore: number };

export type NblTeamRating = { team: string; pointsFor: number; pointsAgainst: number; games: number };

export type NblGameProjection = {
  homeMargin: number;
  total: number;
  marginSd: number;
  totalSd: number;
  home: NblTeamRating | null;
  away: NblTeamRating | null;
  leagueAverage: number;
};

export const NBL_HOME_COURT = 2.5;
const MARGIN_SD = 12.5;
const TOTAL_SD = 16;
const SHRINK_GAMES = 6;
const HALF_LIFE_GAMES = 10;
const PRIOR_SEASON_WEIGHT = 0.4;

export const nblTeamKey = (name: string | null | undefined) => normalizeTeamKey(resolveNblClubName(name) ?? String(name || ''));

export function nblTeamRatings(finals: NblFinal[], currentSeason: number): { ratings: Map<string, NblTeamRating>; leagueAverage: number } {
  const ordered = [...finals]
    .filter((g) => g.season >= currentSeason - 1)
    .sort((a, b) => a.date.localeCompare(b.date));
  const acc = new Map<string, { team: string; wFor: number; wAgainst: number; w: number; games: number; back: number }>();
  let lgSum = 0;
  let lgW = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const g = ordered[i]!;
    const seasonW = g.season === currentSeason ? 1 : PRIOR_SEASON_WEIGHT;
    for (const [team, pf, pa] of [
      [g.home, g.homeScore, g.awayScore],
      [g.away, g.awayScore, g.homeScore],
    ] as const) {
      const key = nblTeamKey(team);
      const row = acc.get(key) ?? { team: resolveNblClubName(team) ?? team, wFor: 0, wAgainst: 0, w: 0, games: 0, back: 0 };
      const w = seasonW * Math.pow(0.5, row.back / HALF_LIFE_GAMES);
      row.wFor += w * pf;
      row.wAgainst += w * pa;
      row.w += w;
      row.games += 1;
      row.back += 1;
      acc.set(key, row);
      lgSum += w * pf;
      lgW += w;
    }
  }
  const leagueAverage = lgW > 0 ? lgSum / lgW : 88;
  const ratings = new Map<string, NblTeamRating>();
  for (const [key, r] of acc) {
    const shrink = r.w / (r.w + SHRINK_GAMES);
    ratings.set(key, {
      team: r.team,
      pointsFor: round(leagueAverage + (r.wFor / r.w - leagueAverage) * shrink, 2),
      pointsAgainst: round(leagueAverage + (r.wAgainst / r.w - leagueAverage) * shrink, 2),
      games: r.games,
    });
  }
  return { ratings, leagueAverage: round(leagueAverage, 2) };
}

export function projectNblGame(home: string, away: string, finals: NblFinal[], currentSeason: number): NblGameProjection {
  const { ratings, leagueAverage: lg } = nblTeamRatings(finals, currentSeason);
  const h = ratings.get(nblTeamKey(home)) ?? null;
  const a = ratings.get(nblTeamKey(away)) ?? null;
  const hFor = h?.pointsFor ?? lg;
  const hAgainst = h?.pointsAgainst ?? lg;
  const aFor = a?.pointsFor ?? lg;
  const aAgainst = a?.pointsAgainst ?? lg;
  const homePts = lg + (hFor - lg) + (aAgainst - lg) + NBL_HOME_COURT / 2;
  const awayPts = lg + (aFor - lg) + (hAgainst - lg) - NBL_HOME_COURT / 2;
  return {
    homeMargin: round(homePts - awayPts, 2),
    total: round(homePts + awayPts, 1),
    marginSd: MARGIN_SD,
    totalSd: TOTAL_SD,
    home: h,
    away: a,
    leagueAverage: lg,
  };
}

export function nblH2hProb(p: NblGameProjection, side: 'home' | 'away'): number {
  const home = 1 - normalCdf(-p.homeMargin / p.marginSd);
  return side === 'home' ? home : 1 - home;
}

/** Selected side covers `line` (its own handicap). Over = covers. */
export function nblSpreadProbs(p: NblGameProjection, side: 'home' | 'away', line: number): SideProbs {
  const margin = side === 'home' ? p.homeMargin : -p.homeMargin;
  return normalSideProbs(margin, p.marginSd, -line);
}

export function nblTotalProbs(p: NblGameProjection, line: number): SideProbs {
  return normalSideProbs(p.total, p.totalSd, line);
}
