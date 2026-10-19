/**
 * Loads everything game-specific for an NBL scan once: matchup ranks, team pace and ratings (every
 * game this season and last, recent games weighted up), the injury report, and each team's last game for rest.
 * Each source fails closed to "no adjustment".
 */

import fs from 'fs';
import path from 'path';
import type { NblPropMarket } from '@/lib/aiPicks/markets';
import type { NblInjuryContext, NblTeamContext } from '@/lib/aiPicks/model/nblContext';
import { injuryPoints, MAX_INJURY_POINTS, nblTeamKey, type NblFinal } from '@/lib/aiPicks/model/nblGames';
import { playedGames } from '@/lib/aiPicks/model/nblProps';
import { round } from '@/lib/aiPicks/model/math';
import { expectedNblGamePace, nblPaceTable, type NblExpectedPace, type NblPaceTable } from '@/lib/aiPicks/model/nblPace';
import { buildNblPropDvpIndex, lookupNblPropDvp, type NblPropDvpIndex } from '@/lib/nbl/playerPropsDvp';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { loadNblTeamGames } from '@/lib/nbl/teamGames';

/** The page is updated about once a round, so a week-old report is still the current one. */
const INJURY_REPORT_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NblInjuryEntry = NblInjuryContext & { team: string; reportedAt: string };

export type NblContextData = {
  teams: Map<string, NblTeamContext>;
  league: { defRtg: number; pace: number } | null;
  /** Every team's games this season and last, and the pace of each game. */
  pace: NblPaceTable;
  injuries: NblInjuryEntry[];
  injuryReportAt: string | null;
  dvp: NblPropDvpIndex | null;
  lastGameByTeam: Map<string, number>;
  /** Each team's last five result times, used to spot long absences. */
  recentGamesByTeam: Map<string, number[]>;
  errors: string[];
};

function paceTable(season: number, nowMs: number, errors: string[]): NblPaceTable {
  try {
    return nblPaceTable(loadNblTeamGames([season - 1, season]), season, nowMs);
  } catch (e) {
    errors.push(`team games: ${(e as Error).message}`);
    return nblPaceTable([], season, nowMs);
  }
}

function teamContexts(table: NblPaceTable): Map<string, NblTeamContext> {
  const out = new Map<string, NblTeamContext>();
  for (const [key, p] of table.teams) {
    out.set(key, { offRtg: p.offRtg, defRtg: p.defRtg, pace: p.pace, paceLast5: p.last5, games: p.games });
  }
  return out;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * When the page itself was last updated ("Tuesday, October 13, 6:00pm AEDT"), which can be days before
 * we scraped it. The text has no year: it is the latest one that is not after the scrape.
 */
export function injuryReportUpdatedAt(text: string | null | undefined, scrapedAt: string): string | null {
  const m = String(text || '').match(/([a-z]+)\s+(\d{1,2}),?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(AEDT|AEST)?/i);
  const scraped = Date.parse(scrapedAt);
  if (!m || !Number.isFinite(scraped)) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase());
  if (month < 0) return null;
  const hour = (Number(m[3]) % 12) + (m[5]!.toLowerCase() === 'pm' ? 12 : 0);
  const offset = m[6]?.toUpperCase() === 'AEST' ? 10 : 11;
  const at = (year: number) => Date.UTC(year, month, Number(m[2]), hour - offset, Number(m[4] ?? 0));
  const year = new Date(scraped).getUTCFullYear();
  const t = at(year) > scraped + DAY_MS ? at(year - 1) : at(year);
  return new Date(t).toISOString();
}

function readInjuries(nowMs: number, errors: string[]): { rows: NblInjuryEntry[]; at: string | null } {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'nbl-injuries.json'), 'utf8')) as {
      generatedAt?: string;
      sourceUpdatedText?: string | null;
      injuries?: Array<{ team?: string; player?: string; status?: string; injury?: string; returning?: string }>;
    };
    const at = (json.generatedAt && injuryReportUpdatedAt(json.sourceUpdatedText, json.generatedAt)) || json.generatedAt || null;
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
  const pace = paceTable(opts.season, opts.nowMs, errors);
  const teams = teamContexts(pace);
  const league = pace.leagueRtg != null && pace.leaguePace != null ? { defRtg: pace.leagueRtg, pace: pace.leaguePace } : null;
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
  return { teams, league, pace, injuries: injuries.rows, injuryReportAt: injuries.at, dvp, lastGameByTeam, recentGamesByTeam, errors };
}

export function expectedPace(data: NblContextData, homeTeam: string, awayTeam: string): NblExpectedPace | null {
  return expectedNblGamePace(data.pace, homeTeam, awayTeam);
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
