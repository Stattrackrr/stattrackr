/**
 * User-named numbers ("11+ aces", "over 8.5") — evaluate from match logs, not a book line.
 */

import { tennisRowsForBestOf } from '@/lib/tennis/chartStats';
import { loadPlayerMatches } from '@/lib/tennis/data';
import type { TennisMatchAnalysis } from '@/lib/tennis/matchAnalystShared';
import type { TennisAskBrief } from '@/lib/tennis/askBrief';
import type { TennisMatchRow, TennisTour } from '@/lib/tennis/types';

export type UserStatKey = 'aces' | 'totalGames' | 'gamesWon' | 'spread';
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

export type UserLineContext = {
  viewingStat?: string | null;
  viewingLine?: number | null;
  listedTotalLine?: number | null;
  bestOf?: 3 | 5 | null;
  playerLast?: string | null;
  opponentLast?: string | null;
  playerName?: string | null;
  opponentName?: string | null;
};

function overUnderRule(under: boolean, threshold: number): UserLineRule {
  if (under) return 'lt';
  return Number.isInteger(threshold) ? 'gte' : 'gt';
}

function statLabel(stat: UserStatKey): string {
  if (stat === 'aces') return 'aces';
  if (stat === 'gamesWon') return 'games won';
  if (stat === 'spread') return 'games handicap';
  return 'total games';
}

function formatCoverDisplay(threshold: number): string {
  const signed = threshold > 0 ? `+${threshold}` : String(threshold);
  return `cover ${signed} games`;
}

function parseCoverLine(q: string, ctx?: UserLineContext): UserStatLine | null {
  const handicapAsk =
    /\bcover\b|\bhandicap\b|\bspread\b|\btoo many\b|\bwin by\b/.test(q) ||
    /[+-]\d+(?:\.\d+)?\s*games/.test(q);
  if (!handicapAsk) return null;
  if (/\baces?\b/.test(q)) return null;
  if (/\b(over|under)\s+\d/.test(q) && !/\bcover\b|\bhandicap\b|\bspread\b/.test(q)) return null;
  if (isTotalGamesPhrase(q)) return null;

  const cover = q.match(/\bcover\s+([+-]?\d+(?:\.\d+)?)\s*games/);
  const signed = q.match(/([+-]\d+(?:\.\d+)?)\s*games/);
  const winBy = q.match(/\bwin by\s+(\d+(?:\.\d+)?)/);
  let threshold: number | null = null;
  if (cover) threshold = Number(cover[1]);
  else if (signed) threshold = Number(signed[1]);
  else if (winBy) threshold = -Number(winBy[1]);
  else if (viewingIsSpread(ctx?.viewingStat) && Number.isFinite(Number(ctx?.viewingLine))) {
    threshold = Number(ctx?.viewingLine);
  }
  if (threshold == null || !Number.isFinite(threshold) || Math.abs(threshold) < 1 || Math.abs(threshold) > 12) {
    return null;
  }
  return {
    stat: 'spread',
    label: statLabel('spread'),
    threshold,
    rule: 'lte',
    display: formatCoverDisplay(threshold),
  };
}

function mentionsName(q: string, name: string | null | undefined): boolean {
  const raw = String(name || '').trim().toLowerCase();
  if (!raw) return false;
  if (q.includes(raw)) return true;
  const last = raw.split(/\s+/).pop() || '';
  return last.length >= 3 && q.includes(last);
}

function isTotalGamesPhrase(q: string): boolean {
  return /\btotal games\b|\bmatch total\b|\bcombined games\b|\bgames in the match\b|\bboth players\b|\brun long\b|\brun short\b|\bgo long\b|\bgo short\b|\bshort match\b|\blong match\b/.test(
    q
  );
}

export function viewingIsPlayerGames(stat: string | null | undefined): boolean {
  return stat === 'gamesWon' || stat === 'gamesLost' || stat === 'oppGamesWon';
}

export function viewingIsSpread(stat: string | null | undefined): boolean {
  return stat === 'spread';
}

function namedSomeone(q: string, ctx?: UserLineContext): boolean {
  return (
    mentionsName(q, ctx?.playerLast) ||
    mentionsName(q, ctx?.playerName) ||
    mentionsName(q, ctx?.opponentLast) ||
    mentionsName(q, ctx?.opponentName)
  );
}

function isExplicitPlayerGames(q: string, ctx?: UserLineContext): boolean {
  if (/\bgames won\b|\bgames lost\b|\bhis games\b|\bher games\b|\bplayer games\b|\bindividual games\b/.test(q)) {
    return true;
  }
  return namedSomeone(q, ctx) && /\bfor\b/.test(q) && /\bgames\b/.test(q);
}

function formatOf(ctx?: UserLineContext): 3 | 5 {
  return ctx?.bestOf === 5 ? 5 : 3;
}

/** Clearly a match total for this format. BO3 18.5 is NOT clear — that is also a normal player line. */
function isClearMatchTotalNumber(threshold: number, ctx?: UserLineContext): boolean {
  if (!Number.isFinite(threshold)) return false;
  return formatOf(ctx) === 5 ? threshold >= 32 : threshold >= 21;
}

function isClearPlayerGamesNumber(threshold: number, ctx?: UserLineContext): boolean {
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  return formatOf(ctx) === 5 ? threshold < 32 : threshold <= 16;
}

function listedTotalMatches(threshold: number, ctx?: UserLineContext): boolean {
  const listed = Number(ctx?.listedTotalLine);
  return Number.isFinite(listed) && Math.abs(listed - threshold) < 0.01;
}

function gamesStatFromAsk(q: string, token: string, threshold: number, ctx?: UserLineContext): UserStatKey {
  if (/ace/.test(token)) return 'aces';
  if (isTotalGamesPhrase(q) && !isExplicitPlayerGames(q, ctx)) return 'totalGames';
  if (/won|lost/.test(token) || isExplicitPlayerGames(q, ctx)) return 'gamesWon';
  if (isClearMatchTotalNumber(threshold, ctx) && !isExplicitPlayerGames(q, ctx)) return 'totalGames';
  if (isClearPlayerGamesNumber(threshold, ctx)) return 'gamesWon';
  if (listedTotalMatches(threshold, ctx) && !isExplicitPlayerGames(q, ctx)) return 'totalGames';
  if (viewingIsPlayerGames(ctx?.viewingStat)) return 'gamesWon';
  if (ctx?.viewingStat === 'totalGames') return 'totalGames';
  return formatOf(ctx) === 3 ? 'gamesWon' : 'totalGames';
}

function statFromRow(row: TennisMatchRow, stat: UserStatKey): number | null {
  if (stat === 'aces') return num(row.aces);
  if (stat === 'gamesWon') return num(row.gamesWon);
  if (stat === 'spread') {
    const stored = num(row.spread);
    if (stored != null) return stored;
    const won = num(row.gamesWon);
    const lost = num(row.gamesLost);
    if (won != null && lost != null) return lost - won;
    return null;
  }
  return num(row.totalGames);
}

function windowRate(rows: TennisMatchRow[], line: UserStatLine, take?: number): UserLineWindow {
  const slice = take ? rows.slice(-take) : rows;
  const values = slice.map((row) => statFromRow(row, line.stat)).filter((v): v is number => v != null);
  const hits = values.filter((v) => userLineClears(v, line)).length;
  return { label: take ? `L${take}` : 'Sample', sample: values.length, hits, pct: pct(hits, values.length) };
}

function lineFromAsk(q: string, ctx?: UserLineContext): { threshold: number; under: boolean | null } | null {
  const dir = q.match(/\b(over|under)\s+(\d+(?:\.\d+)?)/);
  if (dir) return { threshold: Number(dir[2]), under: dir[1] === 'under' };
  const plus = q.match(/(\d+(?:\.\d+)?)\s*(?:\+|plus|or more)/);
  if (plus) return { threshold: Number(plus[1]), under: false };
  const viewing = Number(ctx?.viewingLine);
  if (
    Number.isFinite(viewing) &&
    /\b(over|under|lean|this line|the line|games line|line so|so low|so high)\b/.test(q)
  ) {
    return { threshold: viewing, under: /\bunder\b/.test(q) ? true : /\bover\b/.test(q) ? false : null };
  }
  return null;
}

export function parseUserStatLine(question: string, ctx?: UserLineContext): UserStatLine | null {
  const q = String(question || '').toLowerCase();
  const cover = parseCoverLine(q, ctx);
  if (cover) return cover;
  const plus = q.match(/(\d+(?:\.\d+)?)\s*(?:\+|plus|or more)\s*(aces?|games(?:\s+won)?)/);
  if (plus) {
    const threshold = Number(plus[1]);
    const stat = gamesStatFromAsk(q, plus[2], threshold, ctx);
    return { stat, label: statLabel(stat), threshold, rule: 'gte', display: `${threshold}+ ${statLabel(stat)}` };
  }

  const atLeast = q.match(/at\s+least\s+(\d+(?:\.\d+)?)\s*(aces?|games(?:\s+won)?)/);
  if (atLeast) {
    const threshold = Number(atLeast[1]);
    const stat = gamesStatFromAsk(q, atLeast[2], threshold, ctx);
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
    const stat = gamesStatFromAsk(q, dirFirst[3], threshold, ctx);
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
    const stat = gamesStatFromAsk(q, statFirst[1], threshold, ctx);
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
  if (bare && /\b(good|spot|live|worth|think|over|hit|clear|get|enough|lean)\b/.test(q)) {
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

  const inferred = lineFromAsk(q, ctx);
  if (
    inferred &&
    !isClearMatchTotalNumber(inferred.threshold, ctx) &&
    viewingIsPlayerGames(ctx?.viewingStat) &&
    !isTotalGamesPhrase(q) &&
    !/\baces?\b/.test(q)
  ) {
    const under = inferred.under === true || (inferred.under == null && /\b(low|short|small)\b/.test(q));
    const over = inferred.under === false || (inferred.under == null && /\b(high|big|large)\b/.test(q));
    if (!under && !over && inferred.under != null) return null;
    const asUnder = under && !over ? true : over && !under ? false : inferred.under === true;
    if (inferred.under == null && !under && !over) {
      return {
        stat: 'gamesWon',
        label: statLabel('gamesWon'),
        threshold: inferred.threshold,
        rule: 'gt',
        display: `${inferred.threshold} ${statLabel('gamesWon')}`,
      };
    }
    return {
      stat: 'gamesWon',
      label: statLabel('gamesWon'),
      threshold: inferred.threshold,
      rule: overUnderRule(asUnder, inferred.threshold),
      display: `${asUnder ? 'Under' : 'Over'} ${inferred.threshold} ${statLabel('gamesWon')}`,
    };
  }

  const viewing = Number(ctx?.viewingLine);
  if (
    viewingIsPlayerGames(ctx?.viewingStat) &&
    Number.isFinite(viewing) &&
    !isTotalGamesPhrase(q) &&
    !/\baces?\b/.test(q) &&
    !isClearMatchTotalNumber(Number(q.match(/\b(over|under)\s+(\d+(?:\.\d+)?)/)?.[2] ?? NaN), ctx) &&
    (/\bgames\b/.test(q) || /\bline\b/.test(q) || isExplicitPlayerGames(q, ctx))
  ) {
    const under = /\bunder\b|\bso low\b|\btoo low\b|\blow\b|\bshort\b/.test(q);
    return {
      stat: 'gamesWon',
      label: statLabel('gamesWon'),
      threshold: viewing,
      rule: under ? 'lt' : 'gt',
      display: under ? `Under ${viewing} ${statLabel('gamesWon')}` : `${viewing} ${statLabel('gamesWon')}`,
    };
  }

  if (inferred && isClearMatchTotalNumber(inferred.threshold, ctx) && inferred.under != null && !/\baces?\b/.test(q)) {
    const under = inferred.under;
    return {
      stat: 'totalGames',
      label: statLabel('totalGames'),
      threshold: inferred.threshold,
      rule: overUnderRule(under, inferred.threshold),
      display: `${under ? 'Under' : 'Over'} ${inferred.threshold} ${statLabel('totalGames')}`,
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
  question: string,
  ctx?: UserLineContext
): UserLineEval | null {
  const asked = parseUserStatLine(question, {
    ...ctx,
    bestOf: ctx?.bestOf ?? (analysis.bestOf === 5 ? 5 : 3),
    listedTotalLine: ctx?.listedTotalLine ?? analysis.marketOdds?.listedTotalLine ?? analysis.model.totalsLine ?? null,
    playerLast: ctx?.playerLast || analysis.player.last,
    opponentLast: ctx?.opponentLast || analysis.opponent.last,
    playerName: ctx?.playerName || analysis.player.name,
    opponentName: ctx?.opponentName || analysis.opponent.name,
  });
  if (!asked) return null;

  const side = namedSide(question, analysis) === 'opponent' ? 'opponent' : 'player';
  const subject = side === 'opponent' ? analysis.opponent : analysis.player;
  const other = side === 'opponent' ? analysis.player : analysis.opponent;
  const tour = analysis.tour as TennisTour;
  const format = analysis.bestOf === 5 ? 5 : 3;
  const boTag = `BO${format}`;
  const rows = tennisRowsForBestOf(
    loadPlayerMatches({
      playerName: subject.name,
      tour,
    }),
    format
  );
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
        : asked.stat === 'spread'
          ? subject.l15.gamesWon != null && subject.l15.gamesLost != null
            ? Math.round((subject.l15.gamesLost - subject.l15.gamesWon) * 10) / 10
            : null
          : subject.l15.totalGames;

  const similarValues =
    side === 'player' && asked.stat !== 'spread'
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
      { ...windowRate(rows, asked, 10), label: `L10 ${boTag}` },
      { ...windowRate(rows, asked, 15), label: `L15 ${boTag}` },
      { ...windowRate(rows, asked, 20), label: `L20 ${boTag}` },
      { ...windowRate(vsOpp, asked), label: `vs ${other.last}` },
      ...(onSurface.length ? [{ ...windowRate(onSurface.slice(-15), asked), label: `L15 ${boTag} ${surface}` }] : []),
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
