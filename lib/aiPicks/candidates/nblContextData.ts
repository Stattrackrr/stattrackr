/**
 * Loads everything game-specific for an NBL scan once: matchup ranks, team ratings (this season
 * blended with last by games played), the injury report, and each team's last game for rest.
 * Each source fails closed to "no adjustment".
 */

import fs from 'fs';
import path from 'path';
import type { NblPropMarket } from '@/lib/aiPicks/markets';
import type { NblInjuryContext, NblTeamContext } from '@/lib/aiPicks/model/nblContext';
import { injuryPoints, MAX_INJURY_POINTS, nblTeamKey, type NblFinal } from '@/lib/aiPicks/model/nblGames';
import { playedGames } from '@/lib/aiPicks/model/nblProps';
import { round } from '@/lib/aiPicks/model/math';
import { buildNblPropDvpIndex, lookupNblPropDvp, type NblPropDvpIndex } from '@/lib/nbl/playerPropsDvp';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { loadNblTeamRatings } from '@/lib/nbl/teamRatings';

const INJURY_REPORT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const PRIOR_SEASON_GAMES = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NblInjuryEntry = NblInjuryContext & { team: string; reportedAt: string };

export type NblContextData = {
  teams: Map<string, NblTeamContext>;
  league: { defRtg: number; pace: number } | null;
  injuries: NblInjuryEntry[];
  injuryReportAt: string | null;
  dvp: NblPropDvpIndex | null;
  lastGameByTeam: Map<string, number>;
  /** Each team's last five result times, used to spot long absences. */
  recentGamesByTeam: Map<string, number[]>;
  errors: string[];
};

function blendRatings(season: number, errors: string[]): Map<string, NblTeamContext> {
  const out = new Map<string, NblTeamContext>();
  let cur: ReturnType<typeof loadNblTeamRatings>['teams'] = [];
  let prev: ReturnType<typeof loadNblTeamRatings>['teams'] = [];
  try {
    cur = loadNblTeamRatings(season).teams;
    prev = loadNblTeamRatings(season - 1).teams;
  } catch (e) {
    errors.push(`team ratings: ${(e as Error).message}`);
  }
  const prevBy = new Map(prev.map((t) => [nblTeamKey(t.team), t]));
  const keys = new Set([...cur.map((t) => nblTeamKey(t.team)), ...prevBy.keys()]);
  for (const key of keys) {
    const c = cur.find((t) => nblTeamKey(t.team) === key && t.games > 0);
    const p = prevBy.get(key);
    const pOk = p && p.games > 0 ? p : null;
    if (!c && !pOk) continue;
    const w = c ? (pOk ? c.games / (c.games + PRIOR_SEASON_GAMES) : 1) : 0;
    const mix = (a: number | null | undefined, b: number | null | undefined) =>
      a != null && b != null ? w * a + (1 - w) * b : (a ?? b ?? null);
    const offRtg = mix(c?.offRtg, pOk?.offRtg);
    const defRtg = mix(c?.defRtg, pOk?.defRtg);
    if (offRtg == null || defRtg == null) continue;
    out.set(key, {
      offRtg: round(offRtg, 1),
      defRtg: round(defRtg, 1),
      pace: (() => {
        const v = mix(c?.pace, pOk?.pace);
        return v == null ? null : round(v, 1);
      })(),
      games: (c?.games ?? 0) + (pOk?.games ?? 0),
    });
  }
  return out;
}

function readInjuries(nowMs: number, errors: string[]): { rows: NblInjuryEntry[]; at: string | null } {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'nbl-injuries.json'), 'utf8')) as {
      generatedAt?: string;
      injuries?: Array<{ team?: string; player?: string; status?: string; injury?: string; returning?: string }>;
    };
    const at = json.generatedAt ?? null;
    const t = Date.parse(at ?? '');
    if (!Number.isFinite(t) || nowMs - t > INJURY_REPORT_MAX_AGE_MS) {
      errors.push(`injury report stale (${at ?? 'no date'})`);
      return { rows: [], at };
    }
    const rows = (json.injuries ?? [])
      .filter((r) => r.team && r.player)
      .map((r) => ({ team: r.team!, player: r.player!, status: r.status || 'Out', injury: r.injury, returning: r.returning, reportedAt: at! }));
    return { rows, at };
  } catch (e) {
    errors.push(`injury report: ${(e as Error).message}`);
    return { rows: [], at: null };
  }
}

export function loadNblContextData(opts: { season: number; finals: NblFinal[]; nowMs: number }): NblContextData {
  const errors: string[] = [];
  const teams = blendRatings(opts.season, errors);
  const list = [...teams.values()];
  const paces = list.map((t) => t.pace).filter((p): p is number => p != null);
  const league = list.length
    ? { defRtg: list.reduce((a, t) => a + t.defRtg, 0) / list.length, pace: paces.length ? paces.reduce((a, b) => a + b, 0) / paces.length : 0 }
    : null;
  let dvp: NblPropDvpIndex | null = null;
  try {
    dvp = buildNblPropDvpIndex();
  } catch (e) {
    errors.push(`matchup index: ${(e as Error).message}`);
  }
  const lastGameByTeam = new Map<string, number>();
  const recentGamesByTeam = new Map<string, number[]>();
  for (const f of [...opts.finals].sort((a, b) => a.date.localeCompare(b.date))) {
    const t = Date.parse(f.date);
    if (!(t < opts.nowMs)) continue;
    for (const team of [f.home, f.away]) {
      const key = nblTeamKey(team);
      lastGameByTeam.set(key, t);
      recentGamesByTeam.set(key, [...(recentGamesByTeam.get(key) ?? []), t].slice(-5));
    }
  }
  const injuries = readInjuries(opts.nowMs, errors);
  return { teams, league, injuries: injuries.rows, injuryReportAt: injuries.at, dvp, lastGameByTeam, recentGamesByTeam, errors };
}

export function teamContext(data: NblContextData, team: string): NblTeamContext | null {
  return data.teams.get(nblTeamKey(team)) ?? null;
}

export function restDays(data: NblContextData, team: string, commenceTime: string): number | null {
  const last = data.lastGameByTeam.get(nblTeamKey(team));
  const t = Date.parse(commenceTime);
  if (!last || !Number.isFinite(t)) return null;
  return Math.floor((t - last) / DAY_MS);
}

export function injuriesFor(data: NblContextData, team: string): NblInjuryEntry[] {
  const key = nblTeamKey(team);
  return data.injuries.filter((r) => nblTeamKey(r.team) === key);
}

/** He has played since the report was written, so the listing is out of date. */
export function playedSinceReport(games: NblGameLogRow[] | null, reportedAt: string): boolean {
  const last = games ? playedGames(games).at(-1) : null;
  return Boolean(last?.date && Date.parse(String(last.date)) > Date.parse(reportedAt));
}

export function matchupFor(data: NblContextData, playerId: string, playerName: string, opponent: string, stat: NblPropMarket) {
  if (!data.dvp) return null;
  try {
    const hit = lookupNblPropDvp(data.dvp, { playerId, playerName, opponent, stat });
    return { rank: hit.dvpRating, fieldSize: hit.dvpFieldSize, allowed: hit.dvpStatValue };
  } catch {
    return null;
  }
}

/**
 * Points a team is missing: each listed player's scoring (regulars only), scaled by the share of
 * the team's last five games he played, since games he already missed are in the team's results.
 */
export function teamInjuryImpact(
  data: NblContextData,
  team: string,
  outGames: Array<{ entry: NblInjuryEntry; games: NblGameLogRow[] | null }>,
  season: number
): { points: number; names: string[] } {
  const teamDates = data.recentGamesByTeam.get(nblTeamKey(team)) ?? [];
  let points = 0;
  const names: string[] = [];
  for (const { entry, games } of outGames) {
    if (!games || playedSinceReport(games, entry.reportedAt)) continue;
    const seasonGames = playedGames(games).filter((g) => Number(g.season) >= season - 1);
    if (!seasonGames.length) continue;
    const mpg = seasonGames.reduce((a, g) => a + (g.minutes ?? 0), 0) / seasonGames.length;
    if (mpg < 15) continue;
    const played = playedGames(games).map((g) => Date.parse(String(g.date || '')));
    const missed = teamDates.filter((d) => !played.some((p) => Math.abs(p - d) <= 1.5 * DAY_MS));
    const share = teamDates.length >= 3 ? 1 - missed.length / teamDates.length : 1;
    if (share <= 0) continue;
    const ppg = seasonGames.reduce((a, g) => a + (g.points ?? 0), 0) / seasonGames.length;
    points += injuryPoints(ppg) * share;
    names.push(entry.player);
  }
  return { points: round(Math.min(points, MAX_INJURY_POINTS), 2), names };
}
