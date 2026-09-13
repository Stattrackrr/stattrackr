/**
 * User-named numbers ("11+ aces", "over 8.5") — evaluate from match logs, not a book line.
 */

import { loadPlayerMatches } from '@/lib/tennis/data';
import type { TennisMatchAnalysis } from '@/lib/tennis/matchAnalystShared';
import type { TennisAskBrief } from '@/lib/tennis/askBrief';
import type { TennisMatchRow, TennisTour } from '@/lib/tennis/types';

export type UserStatKey = 'aces' | 'totalGames' | 'gamesWon';
export type UserLineRule = 'gte' | 'gt' | 'lte' | 'lt';

export type UserStatLine = {
  stat: UserStatKey;
  label: string;
  threshold: number;
  rule: UserLineRule;
  display: string;
};

export type UserLineWindow = {
  label: string;
  sample: number;
  hits: number;
  pct: number | null;
};

export type UserLineEval = {
  asked: UserStatLine;
  subject: string;
  player: string;
  opponent: string;
  projection: number | null;
  windows: UserLineWindow[];
  similarVsOpponent: UserLineWindow | null;
  vsOpponentGames: Array<{ date: string | null; value: number; hit: boolean }>;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(hits: number, sample: number): number | null {
  if (!sample) return null;
  return Math.round((hits / sample) * 1000) / 10;
}

export function userLineClears(value: number, line: UserStatLine): boolean {
  if (line.rule === 'gte') return value >= line.threshold;
  if (line.rule === 'gt') return value > line.threshold;
  if (line.rule === 'lte') return value <= line.threshold;
  return value < line.threshold;
}

function namedSide(question: string, analysis: TennisMatchAnalysis): 'player' | 'opponent' | null {
  const q = question.toLowerCase();
  const playerHit = [analysis.player.last, analysis.player.name].some((name) =>
    q.includes(String(name || '').toLowerCase())
  );
  const oppHit = [analysis.opponent.last, analysis.opponent.name].some((name) =>
    q.includes(String(name || '').toLowerCase())
  );
  if (playerHit && !oppHit) return 'player';
  if (oppHit && !playerHit) return 'opponent';
  return null;
}

function normName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normName(a);
  const right = normName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const lastA = left.split(/\s+/).pop() || '';
  const lastB = right.split(/\s+/).pop() || '';
  return lastA.length > 3 && lastA === lastB;
}

function overUnderRule(under: boolean, threshold: number): UserLineRule {
  if (under) return 'lt';
  return Number.isInteger(threshold) ? 'gte' : 'gt';
}

function statLabel(stat: UserStatKey): string {
  if (stat === 'aces') return 'aces';
  if (stat === 'gamesWon') return 'games won';
  return 'total games';
}

function statFromToken(token: string): UserStatKey {
  if (/ace/.test(token)) return 'aces';
  if (/won/.test(token)) return 'gamesWon';
  return 'totalGames';
}

function statFromRow(row: TennisMatchRow, stat: UserStatKey): number | null {
  if (stat === 'aces') return num(row.aces);
  if (stat === 'gamesWon') return num(row.gamesWon);
  return num(row.totalGames);
}

function windowRate(rows: TennisMatchRow[], line: UserStatLine, take?: number): UserLineWindow {
  const slice = take ? rows.slice(-take) : rows;
  const values = slice.map((row) => statFromRow(row, line.stat)).filter((v): v is number => v != null);
  const hits = values.filter((v) => userLineClears(v, line)).length;
  return { label: take ? `L${take}` : 'Sample', sample: values.length, hits, pct: pct(hits, values.length) };
}

export function parseUserStatLine(question: string): UserStatLine | null {
  const q = String(question || '').toLowerCase();
  const plus = q.match(/(\d+(?:\.\d+)?)\s*(?:\+|plus|or more)\s*(aces?|games(?:\s+won)?)/);
  if (plus) {
    const threshold = Number(plus[1]);
    const stat = statFromToken(plus[2]);
    return { stat, label: statLabel(stat), threshold, rule: 'gte', display: `${threshold}+ ${statLabel(stat)}` };
  }

  const atLeast = q.match(/at\s+least\s+(\d+(?:\.\d+)?)\s*(aces?|games(?:\s+won)?)/);
  if (atLeast) {
    const threshold = Number(atLeast[1]);
    const stat = statFromToken(atLeast[2]);
    return {
      stat,
      label: statLabel(stat),
      threshold,
      rule: 'gte',
      display: `at least ${threshold} ${statLabel(stat)}`,
    };
  }

  const dirFirst = q.match(/\b(over|under)\s+(\d+(?:\.\d+)?)\s*(aces?|games(?:\s+won)?)/);
  if (dirFirst) {
    const threshold = Number(dirFirst[2]);
    const stat = statFromToken(dirFirst[3]);
    const under = dirFirst[1] === 'under';
    return {
      stat,
      label: statLabel(stat),
      threshold,
      rule: overUnderRule(under, threshold),
      display: `${under ? 'Under' : 'Over'} ${threshold} ${statLabel(stat)}`,
    };
  }

  const statFirst = q.match(/\b(aces?|games(?:\s+won)?)\s+(over|under)\s+(\d+(?:\.\d+)?)/);
  if (statFirst) {
    const threshold = Number(statFirst[3]);
    const stat = statFromToken(statFirst[1]);
    const under = statFirst[2] === 'under';
    return {
      stat,
      label: statLabel(stat),
      threshold,
      rule: overUnderRule(under, threshold),
      display: `${under ? 'Under' : 'Over'} ${threshold} ${statLabel(stat)}`,
    };
  }

  const bare = q.match(/(\d+(?:\.\d+)?)\s*(aces?)\b/);
  if (bare && /\b(good|spot|live|worth|think|over|hit|clear|get|enough)\b/.test(q)) {
    const threshold = Number(bare[1]);
    const half = !Number.isInteger(threshold);
    return {
      stat: 'aces',
      label: 'aces',
      threshold,
      rule: half ? 'gt' : 'gte',
      display: half ? `Over ${threshold} aces` : `${threshold}+ aces`,
    };
  }

  return null;
}

function formatWindow(row: UserLineWindow): string {
  if (row.pct == null) return `${row.label} ${row.hits}/${row.sample}`;
  return `${row.label} ${row.hits}/${row.sample} (${row.pct}%)`;
}

export function formatUserLineWindow(row: UserLineWindow): string {
  return formatWindow(row);
}

export function evaluateUserStatLine(
  analysis: TennisMatchAnalysis,
  brief: TennisAskBrief,
  question: string
): UserLineEval | null {
  const asked = parseUserStatLine(question);
  if (!asked) return null;

  const side = namedSide(question, analysis) === 'opponent' ? 'opponent' : 'player';
  const subject = side === 'opponent' ? analysis.opponent : analysis.player;
  const other = side === 'opponent' ? analysis.player : analysis.opponent;
  const tour = analysis.tour as TennisTour;
  const rows = loadPlayerMatches({
    playerName: subject.name,
    tour,
  });
  const vsOpp = rows.filter((row) => sameName(row.opponent, other.name));
  const surface = String(analysis.surface || '').toLowerCase();
  const onSurface = surface
    ? rows.filter((row) => String(row.surface || '').toLowerCase() === surface)
    : [];

  const projection =
    asked.stat === 'aces'
      ? Math.round((0.58 * (subject.l15.aces ?? 5) + 0.42 * (other.l15.acesAllowed ?? 5)) * 10) / 10
      : asked.stat === 'gamesWon'
        ? subject.l15.gamesWon
        : subject.l15.totalGames;

  const similarValues =
    side === 'player'
      ? (brief.similarVsOpponent || [])
          .map((row) =>
            asked.stat === 'aces'
              ? row.aces
              : asked.stat === 'totalGames'
                ? row.totalGames
                : row.gamesWon ?? null
          )
          .filter((v): v is number => v != null)
      : [];
  const similarHits = similarValues.filter((v) => userLineClears(v, asked)).length;

  return {
    asked,
    subject: subject.last,
    player: analysis.player.last,
    opponent: analysis.opponent.last,
    projection,
    windows: [
      windowRate(rows, asked, 10),
      windowRate(rows, asked, 15),
      windowRate(rows, asked, 20),
      { ...windowRate(vsOpp, asked), label: `vs ${other.last}` },
      ...(onSurface.length ? [{ ...windowRate(onSurface.slice(-15), asked), label: `L15 ${surface}` }] : []),
    ].filter((row) => row.sample > 0),
    similarVsOpponent: similarValues.length
      ? {
          label: `Similar players vs ${other.last}`,
          sample: similarValues.length,
          hits: similarHits,
          pct: pct(similarHits, similarValues.length),
        }
      : null,
    vsOpponentGames: vsOpp
      .slice(-6)
      .reverse()
      .map((row) => {
        const value = statFromRow(row, asked.stat);
        return {
          date: row.date,
          value: value ?? 0,
          hit: value != null && userLineClears(value, asked),
        };
      })
      .filter((row) => row.value > 0 || row.hit),
  };
}
