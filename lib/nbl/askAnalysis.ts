/**
 * Facts the NBL ask AI reasons from, built from the player's real game logs (not just the engine summary):
 * averages, hit rates at a line, streaks, rest, head to head with dates, minutes, injuries.
 */

import fs from 'fs';
import path from 'path';
import { askAgo, askMonthYear, askRunFromNewest } from '@/lib/ai/ask/timeline';
import type { NblInjuryRow } from '@/lib/nbl/basketballComAuInjuries';
import { omitPlayersWhoPlayedLatestGame } from '@/lib/nbl/nblInjuryActiveFilter';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { getNblClubByCode, normalizeTeamKey, resolveNblClubName } from '@/lib/nblTeamCanonical';

export const NBL_ASK_STAT_WORDS: Record<string, string> = {
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  threeMade: 'threes made',
  pra: 'points + rebounds + assists',
  pr: 'points + rebounds',
  pa: 'points + assists',
  ra: 'rebounds + assists',
};

const STAT_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: 'pra', re: /\bpra\b|\bpts\s*\+\s*reb\s*\+\s*ast\b|\bpoints,?\s*(?:\+|and|&)?\s*rebounds,?\s*(?:\+|and|&)\s*assists\b/ },
  { key: 'pr', re: /\bp\s*\+\s*r\b|\bpts\s*\+\s*reb\b|\bpoints\s*(?:\+|and|&)\s*rebounds\b/ },
  { key: 'pa', re: /\bp\s*\+\s*a\b|\bpts\s*\+\s*ast\b|\bpoints\s*(?:\+|and|&)\s*assists\b/ },
  { key: 'ra', re: /\br\s*\+\s*a\b|\breb\s*\+\s*ast\b|\brebounds\s*(?:\+|and|&)\s*assists\b/ },
  { key: 'threeMade', re: /\b3pm\b|\b3pt\b|\b3s\b|\bthrees?\b|\bthree[- ]pointers?\b|\btriples?\b/ },
  { key: 'rebounds', re: /\brebounds?\b|\bboards\b|\breb\b/ },
  { key: 'assists', re: /\bassists?\b|\bast\b|\bdimes\b/ },
  { key: 'points', re: /\bpoints\b|\bpts\b|\bscor(?:e|es|ing)\b/ },
];

/** Stat named in the question; combos are checked before single stats so "rebounds + assists" is not read as rebounds. */
export function nblStatFromQuestion(question: string): string | null {
  const q = String(question || '').toLowerCase();
  return STAT_PATTERNS.find((row) => row.re.test(q))?.key ?? null;
}

export function nblStatValue(game: NblGameLogRow, stat: string): number | null {
  const n = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const pts = n(game.points);
  const reb = n(game.rebounds);
  const ast = n(game.assists);
  switch (stat) {
    case 'points':
      return pts;
    case 'rebounds':
      return reb;
    case 'assists':
      return ast;
    case 'threeMade':
      return n(game.threeMade);
    case 'pra':
      return n(game.pra) ?? (pts != null && reb != null && ast != null ? pts + reb + ast : null);
    case 'pr':
      return n(game.pr) ?? (pts != null && reb != null ? pts + reb : null);
    case 'pa':
      return n(game.pa) ?? (pts != null && ast != null ? pts + ast : null);
    case 'ra':
      return n(game.ra) ?? (reb != null && ast != null ? reb + ast : null);
    default:
      return null;
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function wholeMinutes(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value);
}

function avg(values: number[]): number | null {
  return values.length ? round1(values.reduce((sum, v) => sum + v, 0) / values.length) : null;
}

function playedGames(games: NblGameLogRow[]): NblGameLogRow[] {
  return games.filter((g) => g.date && (g.minutes ?? 0) > 0);
}

function teamWon(game: NblGameLogRow): boolean | null {
  const r = String(game.result || '').trim().toUpperCase();
  if (r.startsWith('W')) return true;
  if (r.startsWith('L')) return false;
  return null;
}

function clubShort(code: string | null | undefined, fallback?: string | null): string {
  return (code && getNblClubByCode(code)?.name) || fallback || code || '';
}

export type NblLineWindow = { window: string; games: number; overs: number; unders: number; average: number | null };

function lineWindow(rows: NblGameLogRow[], stat: string, line: number, window: string): NblLineWindow | null {
  const values = rows.map((g) => nblStatValue(g, stat)).filter((v): v is number => v != null);
  if (!values.length) return null;
  return {
    window,
    games: values.length,
    overs: values.filter((v) => v > line).length,
    unders: values.filter((v) => v < line).length,
    average: avg(values),
  };
}

function overUnderRun(rows: NblGameLogRow[], stat: string, line: number): string | null {
  const flags = rows
    .map((g) => nblStatValue(g, stat))
    .filter((v): v is number => v != null && v !== line)
    .map((v) => v > line);
  const run = askRunFromNewest(flags);
  return run && run.count >= 2 ? `${run.value ? 'over' : 'under'} ${line} in his last ${run.count} in a row` : null;
}

export type NblLineRead = {
  stat: string;
  statWords: string;
  line: number;
  windows: NblLineWindow[];
  run: string | null;
};

export function nblLineRead(
  games: NblGameLogRow[],
  stat: string,
  line: number,
  opponentCode: string | null
): NblLineRead | null {
  const played = playedGames(games);
  if (!played.length) return null;
  const latestSeason = Math.max(...played.map((g) => g.season || 0));
  const vs = opponentCode ? played.filter((g) => g.opponentCode === opponentCode) : [];
  const windows: NblLineWindow[] = [];
  for (const size of [5, 10, 15]) {
    const row = lineWindow(played.slice(-size), stat, line, `last ${Math.min(size, played.length)} games`);
    if (row && !windows.some((w) => w.games === row.games)) windows.push(row);
  }
  const season = lineWindow(played.filter((g) => g.season === latestSeason), stat, line, 'this season');
  if (season) windows.push(season);
  const against = vs.length ? lineWindow(vs, stat, line, `against ${clubShort(opponentCode)}`) : null;
  if (against) windows.push(against);
  return { stat, statWords: NBL_ASK_STAT_WORDS[stat] ?? stat, line, windows, run: overUnderRun(played, stat, line) };
}

const AVERAGE_STATS = ['points', 'rebounds', 'assists', 'threeMade', 'pra'] as const;

function averagesFor(rows: NblGameLogRow[]) {
  const out: Record<string, number | null> = {};
  for (const stat of AVERAGE_STATS) {
    out[NBL_ASK_STAT_WORDS[stat]] = avg(rows.map((g) => nblStatValue(g, stat)).filter((v): v is number => v != null));
  }
  out.minutes = avg(rows.map((g) => g.minutes).filter((v): v is number => v != null && v > 0));
  return out;
}

export function nblPlayerForm(games: NblGameLogRow[], stat: string, now = Date.now()) {
  const played = playedGames(games);
  const latestSeason = played.length ? Math.max(...played.map((g) => g.season || 0)) : null;
  const season = played.filter((g) => g.season === latestSeason);
  const newest = played.at(-1);
  const lastAgo = newest ? askAgo(newest.date, now) : null;
  const results = played.map(teamWon).filter((v): v is boolean => v != null);
  const run = askRunFromNewest(results);
  const oldest15 = played.slice(-15)[0];
  const statWords = NBL_ASK_STAT_WORDS[stat] ?? stat;
  return {
    gamesThisSeason: season.length,
    averages: {
      last5: averagesFor(played.slice(-5)),
      last10: averagesFor(played.slice(-10)),
      thisSeason: averagesFor(season),
    },
    lastGames: played
      .slice(-5)
      .reverse()
      .map((g) => ({
        when: askAgo(g.date, now)?.ago ?? null,
        opponent: clubShort(g.opponentCode, g.opponent),
        [statWords]: nblStatValue(g, stat),
        minutes: wholeMinutes(g.minutes),
        teamResult: g.result,
      })),
    timeline: {
      currentStreak: run && run.count >= 2 ? `team ${run.value ? 'won' : 'lost'} ${run.count} in a row in games he played` : null,
      lastPlayed:
        newest && lastAgo
          ? `${lastAgo.ago} against ${clubShort(newest.opponentCode, newest.opponent)} (${nblStatValue(newest, stat) ?? '—'} ${statWords}, ${wholeMinutes(newest.minutes) ?? '—'} minutes)`
          : null,
      daysSinceLastMatch: lastAgo?.days ?? null,
      last15GoesBackTo: oldest15 ? askAgo(oldest15.date, now)?.ago ?? null : null,
    },
  };
}

export function nblHeadToHead(games: NblGameLogRow[], opponentCode: string | null, stat: string, now = Date.now()) {
  const played = playedGames(games);
  const statWords = NBL_ASK_STAT_WORDS[stat] ?? stat;
  const meetings = opponentCode ? played.filter((g) => g.opponentCode === opponentCode) : [];
  const last = meetings.at(-1);
  const lastAgo = last ? askAgo(last.date, now) : null;
  return {
    opponent: clubShort(opponentCode),
    onFileSince: askMonthYear(played[0]?.date),
    games: meetings.length,
    lastMeeting: lastAgo?.ago ?? null,
    monthsSinceLastMeeting: lastAgo?.months ?? null,
    meetings: meetings
      .slice(-6)
      .reverse()
      .map((g) => ({
        when: askAgo(g.date, now)?.ago ?? null,
        [statWords]: nblStatValue(g, stat),
        minutes: wholeMinutes(g.minutes),
        teamResult: g.result,
      })),
  };
}

let injuryCache: { mtimeMs: number; rows: NblInjuryRow[] } | null = null;

function loadInjuries(): NblInjuryRow[] {
  const file = path.join(process.cwd(), 'data', 'nbl-injuries.json');
  try {
    const stat = fs.statSync(file);
    if (injuryCache && injuryCache.mtimeMs === stat.mtimeMs) return injuryCache.rows;
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { injuries?: NblInjuryRow[] };
    const rows = omitPlayersWhoPlayedLatestGame(Array.isArray(json.injuries) ? json.injuries : []);
    injuryCache = { mtimeMs: stat.mtimeMs, rows };
    return rows;
  } catch {
    return [];
  }
}

function teamKeyFor(codeOrName: string | null | undefined): string | null {
  if (!codeOrName) return null;
  const name = getNblClubByCode(codeOrName)?.name || resolveNblClubName(codeOrName) || codeOrName;
  return normalizeTeamKey(name);
}

export function nblInjuriesFor(teamCode: string | null, opponentCode: string | null, playerName: string) {
  const rows = loadInjuries();
  const pick = (code: string | null) => {
    const key = teamKeyFor(code);
    if (!key) return [];
    return rows
      .filter((row) => teamKeyFor(row.team) === key && row.player !== playerName)
      .map((row) => ({ player: row.player, status: row.status || 'Out', injury: row.injury, returning: row.returning }));
  };
  return { teammatesOut: pick(teamCode), opponentOut: pick(opponentCode) };
}
