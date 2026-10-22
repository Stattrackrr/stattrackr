/**
 * NBA ask AI. Same shared brain as NBL and tennis (lib/ai/ask). NBA has no props engine, so the
 * pack is the player's real game logs, the stored prop prices, what this defence allows and who is out.
 */

import { askPriceCheck, type AskPriceOffer } from '@/lib/ai/ask/guards';
import { askReplyText, type AskMessage, type AskReplyText } from '@/lib/ai/ask/llm';
import { buildAskSystemPrompt, buildAskUserContent } from '@/lib/ai/ask/rules';
import { runAskAi } from '@/lib/ai/ask/run';
import { askAgo, askMonthYear, askRunFromNewest } from '@/lib/ai/ask/timeline';
import { nbaPunterQuestions } from './askSuggestions';
import { findNbaOddsGame, getNbaOddsCache, nbaPlayerPropsByStat } from './odds';
import { nbaAmericanToDecimal, nbaBookLines, type NbaBookRow } from './oddsTypes';
import { resolveNbaDataSeason } from './season';
import { loadNbaInjuries, loadNbaPlayerGameLogs } from './server';
import { loadNbaDefenseShotChart, loadNbaPlayerShotChart } from './shotChart';
import { NBA_SHOT_ZONE_LABELS, type NbaShotZoneId } from './shotZonesShared';
import { buildNbaSteStatsPayload } from './steStats';
import type { NbaSteStatKey } from './teamSteStatsShared';
import { getNbaClubByCode, NBA_CHART_HISTORY_YEARS, nbaTeamCode, resolveNbaClub } from './teams';
import type { NbaGameLogRow } from './types';

export type NbaAskReply = {
  answer: string;
  breakdown: string[];
  source: 'model' | 'stats';
  suggestions: string[];
};

export const NBA_ASK_STAT_WORDS: Record<string, string> = {
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  threeMade: 'threes made',
  steals: 'steals',
  blocks: 'blocks',
  turnovers: 'turnovers',
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
  { key: 'steals', re: /\bsteals?\b|\bstl\b/ },
  { key: 'blocks', re: /\bblocks?\b|\bblk\b/ },
  { key: 'turnovers', re: /\bturnovers?\b|\btov?\b/ },
  { key: 'points', re: /\bpoints\b|\bpts\b|\bscor(?:e|es|ing)\b/ },
];

/** Opponent "allowed" metric that matches each market. */
const ALLOWED_METRIC: Partial<Record<string, NbaSteStatKey>> = {
  points: 'pts',
  rebounds: 'reb',
  assists: 'ast',
  threeMade: 'fg3_pct',
  steals: 'stl',
  blocks: 'blk',
  pra: 'pts',
  pr: 'pts',
  pa: 'pts',
  ra: 'reb',
};

const MIN_DECIMAL = 1.5;
const BEST_PLAY_STATS = ['points', 'rebounds', 'assists', 'threeMade', 'pra', 'pr', 'pa', 'ra'];

export function nbaStatFromQuestion(question: string): string | null {
  const q = String(question || '').toLowerCase();
  return STAT_PATTERNS.find((row) => row.re.test(q))?.key ?? null;
}

type Intent = 'take' | 'other_markets' | 'best_line' | 'shot' | 'model';

export function nbaQuestionIntent(question: string): Intent {
  const q = question.toLowerCase();
  if (/\bwhere does\b|\bscore from\b|\bshot chart\b|\bfrom against\b/.test(q)) return 'shot';
  if (/\bhow do you see\b|\bwhat(?:'s| is) the (?:model|lean)\b/.test(q)) return 'model';
  if (/\bbest (?:line|bet|play|prop|market|pick)s?\b/.test(q) && !/\bprices?\b|\bbooks?\b|\bbookies?\b/.test(q) && !nbaStatFromQuestion(q)) {
    return 'take';
  }
  if (/\bother markets?\b|\banother market\b|\bother lines?\b|\bother props?\b|\bwhat else\b|\banything else\b|\bany other\b/.test(q)) {
    return 'other_markets';
  }
  if (
    /\bif you had to\b|\bhad to (bet|take|play|pick)\b|\bwhat(?:'s| is) your (?:take|play|bet|pick)\b/.test(q) ||
    /\bwhat would you (?:take|bet|play|pick)\b|\bwhat are you taking\b|\byour pick\b|\bwhich prop\b|\bquick bet\b/.test(q)
  ) {
    return 'take';
  }
  if (/\bbest line\b|\bbest price\b|\bwhich book|\bbookies?\b|\bwhat(?:'s| is) the line\b|\bwhich line\b|\bwhat line\b/.test(q)) {
    return 'best_line';
  }
  return 'model';
}

export function nbaStatValue(game: NbaGameLogRow, stat: string): number | null {
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
    case 'steals':
      return n(game.steals);
    case 'blocks':
      return n(game.blocks);
    case 'turnovers':
      return n(game.turnovers);
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

const round1 = (v: number) => Math.round(v * 10) / 10;
const avg = (values: number[]) => (values.length ? round1(values.reduce((s, v) => s + v, 0) / values.length) : null);
const wholeMinutes = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v));
const statWords = (stat: string) => NBA_ASK_STAT_WORDS[stat] ?? stat;
const clubName = (code: string | null | undefined) => (code && getNbaClubByCode(code)?.name) || code || '';
const NAME_SUFFIX = /^(?:jr|sr|ii|iii|iv|v)\.?$/i;

/** "Jabari Smith Jr." -> "Smith". */
export function nbaAskLastName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && NAME_SUFFIX.test(parts.at(-1)!)) parts.pop();
  return parts.at(-1) || name;
}
const lastNameOf = nbaAskLastName;

const AVERAGE_WORDS = Object.values(NBA_ASK_STAT_WORDS).sort((a, b) => b.length - a.length);
const AVERAGE_WORDS_RE = AVERAGE_WORDS.map((w) => w.replace(/[+]/g, '\\+').replace(/\s+/g, '\\s+')).join('|');
const AVERAGE_CLAIMS = [
  new RegExp(`averag(?:e|es|ed|ing)\\s+(?:of\\s+|about\\s+|around\\s+)?(\\d+(?:\\.\\d+)?)\\s+(${AVERAGE_WORDS_RE})(?![\\w+])`, 'gi'),
  new RegExp(`(${AVERAGE_WORDS_RE})\\s+average\\s+(?:is|was|of|at|sits at)\\s+(\\d+(?:\\.\\d+)?)`, 'gi'),
];

/** Pack `player.averages` keys -> the window a sentence would name. */
const AVERAGES_KEY_WINDOW: Record<string, string> = { last5: 'last5', last10: 'last10', thisSeason: 'season' };

/** Windows named in a sentence or a hit-rate label: "this season", "last 10", "against San Antonio". */
function windowsIn(text: string): Set<string> {
  const s = text.toLowerCase();
  const out = new Set<string>();
  if (/\bthis season\b|\bseason average\b/.test(s)) out.add('season');
  for (const m of s.matchAll(/\blast\s+(\d+)\b/g)) out.add(`last${m[1]}`);
  if (/\bagainst\b|\bhead to head\b|\bmeetings?\b/.test(s)) out.add('against');
  return out;
}

type KnownAverage = { words: string; window: string | null; value: number };

/** Every average the pack gives, with its market and window when it has one. */
function knownAverages(pack: unknown): KnownAverage[] {
  const known: KnownAverage[] = [];
  const add = (words: string, window: string | null, v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) known.push({ words, window, value: v });
  };
  const walk = (node: unknown, market: string | null, window: string | null) => {
    if (Array.isArray(node)) return node.forEach((item) => walk(item, market, window));
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const m = typeof obj.market === 'string' ? obj.market : market;
    const w = typeof obj.window === 'string' ? [...windowsIn(obj.window)][0] ?? null : window;
    if (m && 'average' in obj) add(m, w, obj.average);
    for (const [key, value] of Object.entries(obj)) {
      if (AVERAGE_WORDS.includes(key)) add(key, w, value);
      walk(value, m, AVERAGES_KEY_WINDOW[key] ?? w);
    }
  };
  walk(pack, null, null);
  return known;
}

/** The sentence around `index`, ignoring decimal points ("27.8"). */
function sentenceAt(text: string, index: number): string {
  const ends = [...text.matchAll(/[.!?](?=\s|$)/g)].map((m) => m.index!);
  const start = ends.filter((e) => e < index).at(-1);
  const end = ends.find((e) => e >= index);
  return text.slice(start == null ? 0 : start + 1, end == null ? text.length : end + 1);
}

/**
 * "averaging 30 points + rebounds + assists this season" claims whose number is not that market's
 * average for the window named in the same sentence (any window when none is named).
 */
export function nbaAverageMismatches(text: string, pack: unknown): string[] {
  const known = knownAverages(pack);
  const bad: string[] = [];
  for (const [i, re] of AVERAGE_CLAIMS.entries()) {
    for (const m of text.matchAll(re)) {
      const [num, words] = i === 0 ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
      const key = words.toLowerCase().replace(/\s+/g, ' ');
      const n = Number(num);
      const windows = windowsIn(sentenceAt(text, m.index!));
      const market = known.filter((k) => k.words === key);
      const scoped = windows.size ? market.filter((k) => k.window && windows.has(k.window)) : market;
      // A window the pack has no average for (e.g. "last 3") can't be checked.
      if (windows.size && !scoped.length) continue;
      const ok = scoped.some((k) => Math.abs(round1(k.value) - n) < 0.05 || (Number.isInteger(n) && Math.round(k.value) === n));
      if (!ok) bad.push(m[0]);
    }
  }
  return bad;
}

function playedGames(games: NbaGameLogRow[]): NbaGameLogRow[] {
  return games.filter((g) => g.date && (g.minutes ?? 0) > 0);
}

type LineWindow = { window: string; games: number; overs: number; unders: number; average: number | null };
type LineRead = { stat: string; statWords: string; line: number; windows: LineWindow[]; run: string | null };

function lineWindow(rows: NbaGameLogRow[], stat: string, line: number, window: string): LineWindow | null {
  const values = rows.map((g) => nbaStatValue(g, stat)).filter((v): v is number => v != null);
  if (!values.length) return null;
  return {
    window,
    games: values.length,
    overs: values.filter((v) => v > line).length,
    unders: values.filter((v) => v < line).length,
    average: avg(values),
  };
}

function lineRead(games: NbaGameLogRow[], stat: string, line: number, opponentCode: string | null): LineRead | null {
  const played = playedGames(games);
  if (!played.length) return null;
  const latestSeason = Math.max(...played.map((g) => g.season || 0));
  const windows: LineWindow[] = [];
  for (const size of [5, 10, 15]) {
    const row = lineWindow(played.slice(-size), stat, line, `last ${Math.min(size, played.length)} games`);
    if (row && !windows.some((w) => w.games === row.games)) windows.push(row);
  }
  const season = lineWindow(played.filter((g) => g.season === latestSeason), stat, line, 'this season');
  if (season) windows.push(season);
  const vs = opponentCode ? played.filter((g) => g.opponentCode === opponentCode) : [];
  const against = vs.length ? lineWindow(vs, stat, line, `against ${clubName(opponentCode)}`) : null;
  if (against) windows.push(against);
  const flags = played
    .map((g) => nbaStatValue(g, stat))
    .filter((v): v is number => v != null && v !== line)
    .map((v) => v > line);
  const run = askRunFromNewest(flags);
  return {
    stat,
    statWords: statWords(stat),
    line,
    windows,
    run: run && run.count >= 2 ? `${run.value ? 'over' : 'under'} ${line} in his last ${run.count} in a row` : null,
  };
}

/** Every combo is listed so the model never adds them up (or mislabels one) itself. */
function averagesFor(rows: NbaGameLogRow[], focusStat: string) {
  const out: Record<string, number | null> = {};
  for (const stat of new Set([...BEST_PLAY_STATS, focusStat])) {
    out[statWords(stat)] = avg(rows.map((g) => nbaStatValue(g, stat)).filter((v): v is number => v != null));
  }
  out.minutes = avg(rows.map((g) => g.minutes).filter((v): v is number => v != null && v > 0));
  return out;
}

function playerForm(games: NbaGameLogRow[], stat: string, now = Date.now()) {
  const played = playedGames(games);
  const latestSeason = played.length ? Math.max(...played.map((g) => g.season || 0)) : null;
  const season = played.filter((g) => g.season === latestSeason);
  const newest = played.at(-1);
  const lastAgo = newest ? askAgo(newest.date, now) : null;
  const results = played
    .map((g) => String(g.result || '').trim().toUpperCase())
    .map((r) => (r.startsWith('W') ? true : r.startsWith('L') ? false : null))
    .filter((v): v is boolean => v != null);
  const run = askRunFromNewest(results);
  const oldest15 = played.slice(-15)[0];
  const words = statWords(stat);
  return {
    gamesThisSeason: season.length,
    averages: {
      last5: averagesFor(played.slice(-5), stat),
      last10: averagesFor(played.slice(-10), stat),
      thisSeason: averagesFor(season, stat),
    },
    lastGames: played
      .slice(-5)
      .reverse()
      .map((g) => ({
        when: askAgo(g.date, now)?.ago ?? null,
        opponent: clubName(g.opponentCode) || g.opponent,
        [words]: nbaStatValue(g, stat),
        minutes: wholeMinutes(g.minutes),
        teamResult: g.result,
      })),
    timeline: {
      currentStreak: run && run.count >= 2 ? `team ${run.value ? 'won' : 'lost'} ${run.count} in a row in games he played` : null,
      lastPlayed:
        newest && lastAgo
          ? `${lastAgo.ago} against ${clubName(newest.opponentCode) || newest.opponent} (${nbaStatValue(newest, stat) ?? '—'} ${words}, ${wholeMinutes(newest.minutes) ?? '—'} minutes)`
          : null,
      daysSinceLastMatch: lastAgo?.days ?? null,
      last15GoesBackTo: oldest15 ? askAgo(oldest15.date, now)?.ago ?? null : null,
    },
  };
}

function headToHead(games: NbaGameLogRow[], opponentCode: string | null, stat: string, now = Date.now()) {
  const played = playedGames(games);
  const words = statWords(stat);
  const meetings = opponentCode ? played.filter((g) => g.opponentCode === opponentCode) : [];
  const last = meetings.at(-1);
  const lastAgo = last ? askAgo(last.date, now) : null;
  return {
    opponent: clubName(opponentCode),
    onFileSince: askMonthYear(played[0]?.date),
    games: meetings.length,
    lastMeeting: lastAgo?.ago ?? null,
    monthsSinceLastMeeting: lastAgo?.months ?? null,
    meetings: meetings
      .slice(-6)
      .reverse()
      .map((g) => ({
        when: askAgo(g.date, now)?.ago ?? null,
        [words]: nbaStatValue(g, stat),
        minutes: wholeMinutes(g.minutes),
        teamResult: g.result,
      })),
  };
}

type Quote = { line: number; price: number; books: string[] };
type LineQuotes = { line: number; over: Quote | null; under: Quote | null; milestone: boolean };

/** Best over and under per line across every book for one market, decimal prices. */
function marketLines(books: NbaBookRow[]): LineQuotes[] {
  const byLine = new Map<string, LineQuotes>();
  const better = (prev: Quote | null, price: number | null, line: number, book: string): Quote | null => {
    if (price == null) return prev;
    if (!prev || price > prev.price + 1e-9) return { line, price: round2(price), books: [book] };
    if (Math.abs(price - prev.price) < 1e-9 && !prev.books.includes(book)) return { ...prev, books: [...prev.books, book] };
    return prev;
  };
  for (const book of books) {
    for (const l of nbaBookLines(book)) {
      const line = Number(l.line);
      if (!Number.isFinite(line)) continue;
      const key = `${l.kind}|${line}`;
      const row = byLine.get(key) ?? { line, over: null, under: null, milestone: l.kind === 'milestone' };
      row.over = better(row.over, nbaAmericanToDecimal(l.over), line, book.name);
      row.under = better(row.under, nbaAmericanToDecimal(l.under), line, book.name);
      byLine.set(key, row);
    }
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The main line is the most balanced two-way price. */
function mainLine(lines: LineQuotes[]): LineQuotes | null {
  const twoWay = lines.filter((l) => !l.milestone && l.over && l.under);
  if (!twoWay.length) return lines[0] ?? null;
  return twoWay.sort((a, b) => Math.abs(a.over!.price - a.under!.price) - Math.abs(b.over!.price - b.under!.price))[0];
}

function priceText(q: Quote): string {
  return `${q.price.toFixed(2)}${q.books.length ? ` (${q.books.join(', ')})` : ''}`;
}

const isFair = (q: Quote | null | undefined): q is Quote => Boolean(q && q.price >= MIN_DECIMAL - 1e-9);

const RECORD_WEIGHTS = { last5: 0.15, last10: 0.3, last15: 0.15, season: 0.2, against: 0.2 } as const;
const MIN_LIKED_RECORD = 0.55;

function sideRecord(read: LineRead, side: 'over' | 'under'): number | null {
  let total = 0;
  let weight = 0;
  for (const w of read.windows) {
    if (!w.games) continue;
    const key = w.window.startsWith('against ')
      ? 'against'
      : w.window === 'this season'
        ? 'season'
        : w.games <= 5
          ? 'last5'
          : w.games <= 10
            ? 'last10'
            : 'last15';
    if ((key === 'against' || key === 'season') && w.games < 3) continue;
    total += RECORD_WEIGHTS[key] * ((side === 'over' ? w.overs : w.unders) / w.games);
    weight += RECORD_WEIGHTS[key];
  }
  return weight ? total / weight : null;
}

type RankedBet = { stat: string; side: 'over' | 'under'; quote: Quote; read: LineRead; score: number };

function byBet(a: RankedBet, b: RankedBet): number {
  return (
    Math.round(b.score * 20) - Math.round(a.score * 20) ||
    b.quote.price - a.quote.price ||
    b.quote.books.length - a.quote.books.length ||
    b.score - a.score
  );
}

type Ctx = {
  intent: Intent;
  games: NbaGameLogRow[];
  player: string;
  last: string;
  teamCode: string | null;
  opponentCode: string | null;
  stat: string;
  line: number | null;
  lineFromUser: boolean;
  read: LineRead | null;
  markets: Record<string, LineQuotes[]>;
  ranked: RankedBet[];
  defence: Record<string, { allows: number; rank: number; of: number } | null>;
  shotProfile: string[];
  injuries: { teammatesOut: Array<Record<string, string | null>>; opponentOut: Array<Record<string, string | null>> };
};

const readFor = (ctx: Ctx, stat: string, line: number | null) =>
  line == null ? null : lineRead(ctx.games, stat, line, ctx.opponentCode);

function rankBets(ctx: Ctx): RankedBet[] {
  const best = new Map<string, RankedBet>();
  for (const stat of BEST_PLAY_STATS) {
    for (const row of ctx.markets[stat] ?? []) {
      const read = readFor(ctx, stat, row.line);
      if (!read || !read.windows.some((w) => w.window.startsWith('last ') && w.games >= 4)) continue;
      for (const side of ['over', 'under'] as const) {
        const quote = side === 'over' ? row.over : row.under;
        if (!isFair(quote)) continue;
        const score = sideRecord(read, side);
        if (score == null || score < MIN_LIKED_RECORD) continue;
        const bet: RankedBet = { stat, side, quote, read, score };
        const prev = best.get(stat);
        if (!prev || byBet(bet, prev) < 0) best.set(stat, bet);
      }
    }
  }
  return [...best.values()].sort(byBet);
}

function recentWindow(read: LineRead | null) {
  return (read?.windows || []).filter((w) => w.window.startsWith('last ') && w.games <= 10).at(-1) ?? null;
}

function betText(ctx: Ctx, bet: RankedBet): string {
  return `${ctx.last} ${bet.read.statWords} ${bet.side} ${bet.quote.line} at ${priceText(bet.quote)}`;
}

function defenceLine(ctx: Ctx, stat: string): string | null {
  const d = ctx.defence[stat];
  if (!d) return null;
  const metric = ALLOWED_METRIC[stat];
  const what = metric === 'fg3_pct' ? `${round1(d.allows)}% from three` : `${round1(d.allows)} ${statWords(stat === 'threeMade' ? 'points' : stat)} a game`;
  return `${clubName(ctx.opponentCode)} allow ${what}, ${ordinal(d.rank)} toughest of ${d.of}.`;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

function logBreakdown(ctx: Ctx, read: LineRead | null): string[] {
  const lines: string[] = [];
  const form = playerForm(ctx.games, read?.stat ?? ctx.stat);
  if (read) {
    const recent = recentWindow(read);
    if (recent) lines.push(`${ctx.last} has gone over ${read.line} ${read.statWords} in ${recent.overs} of his ${recent.window}.`);
    const season = read.windows.find((w) => w.window === 'this season');
    if (season && season.games >= 3 && season.games !== recent?.games) {
      lines.push(`This season it is ${season.overs} of ${season.games}, averaging ${season.average} ${read.statWords}.`);
    }
    if (read.run) lines.push(`He has gone ${read.run}.`);
    const vs = read.windows.find((w) => w.window.startsWith('against '));
    if (vs) {
      const h2h = headToHead(ctx.games, ctx.opponentCode, read.stat);
      const when = h2h.lastMeeting ? `, the last one ${h2h.lastMeeting}` : '';
      lines.push(`${vs.window.replace(/^against/, 'Against')} he has gone over in ${vs.overs} of ${vs.games}${when}.`);
    }
  }
  const def = defenceLine(ctx, read?.stat ?? ctx.stat);
  if (def) lines.push(def);
  const minutes = form.averages.last5.minutes;
  const seasonMinutes = form.averages.thisSeason.minutes;
  if (minutes != null && seasonMinutes != null) {
    lines.push(`He is playing ${minutes} minutes over his last 5, against ${seasonMinutes} for the season.`);
  }
  if (ctx.injuries.teammatesOut.length) {
    lines.push(`Teammates out: ${ctx.injuries.teammatesOut.map((row) => row.player).join(', ')}.`);
  }
  return lines.slice(0, 6);
}

function localModelReply(ctx: Ctx): AskReplyText {
  const read = ctx.read;
  const words = statWords(ctx.stat);
  const opp = clubName(ctx.opponentCode);
  const breakdown = logBreakdown(ctx, read);
  if (!read) {
    return { answer: `There is no ${words} line on the board for ${ctx.last} against ${opp} yet.`, breakdown };
  }
  const l10 = recentWindow(read);
  const side: 'over' | 'under' | null =
    l10 && l10.games >= 4
      ? l10.overs / l10.games >= 0.6
        ? 'over'
        : l10.unders / l10.games >= 0.6
          ? 'under'
          : null
      : null;
  const market = `${ctx.last} ${words} ${read.line} against ${opp}`;
  if (!side) return { answer: `I wouldn't force ${market}. The numbers point both ways.`, breakdown };
  const row = (ctx.markets[ctx.stat] ?? []).find((r) => r.line === read.line);
  const price = side === 'over' ? row?.over : row?.under;
  const head = price
    ? `I'd lean ${ctx.last} ${side} ${read.line} ${words} at ${priceText(price)}.`
    : `I'd lean ${ctx.last} ${side} ${read.line} ${words}.`;
  const why = l10 ? ` He has gone ${side} in ${side === 'over' ? l10.overs : l10.unders} of his last ${l10.games}.` : '';
  return { answer: `${head}${why}`, breakdown };
}

function localBestLineReply(ctx: Ctx): AskReplyText {
  const rows = ctx.markets[ctx.stat] ?? [];
  const words = statWords(ctx.stat);
  const pickBest = (side: 'over' | 'under') =>
    rows
      .map((r) => (side === 'over' ? r.over : r.under))
      .filter((q): q is Quote => Boolean(q))
      .filter((q) => !ctx.lineFromUser || q.line === ctx.line)
      .sort((a, b) => Math.abs(a.line - (ctx.line ?? a.line)) - Math.abs(b.line - (ctx.line ?? b.line)) || b.price - a.price)[0];
  const over = pickBest('over');
  const under = pickBest('under');
  if (!over && !under) return { answer: `No ${words} price was on the board for ${ctx.last} when the lines were last checked.`, breakdown: [] };
  const parts = [
    over ? `Best over price for ${ctx.last}'s ${words} is ${over.line} at ${priceText(over)}.` : null,
    under ? `Best under is ${under.line} at ${priceText(under)}.` : null,
  ].filter(Boolean);
  const view = localModelReply(ctx);
  return { answer: `${parts.join(' ')} ${view.answer}`, breakdown: view.breakdown };
}

function localTakeReply(ctx: Ctx): AskReplyText {
  const [top, next] = ctx.ranked;
  if (!top) return localModelReply(ctx);
  const also = next ? ` I also like ${betText(ctx, next)}.` : '';
  const breakdown = [top, next]
    .filter((b): b is RankedBet => Boolean(b))
    .map((bet) => {
      const recent = recentWindow(bet.read);
      if (!recent) return null;
      return `${bet.read.statWords} ${bet.side} ${bet.quote.line}: ${bet.side === 'over' ? recent.overs : recent.unders} of his ${recent.window}.`;
    })
    .filter((l): l is string => Boolean(l));
  return { answer: `I'd take ${betText(ctx, top)}.${also}`, breakdown };
}

function localOtherMarketsReply(ctx: Ctx): AskReplyText {
  const others = ctx.ranked.filter((b) => b.stat !== ctx.stat).slice(0, 3);
  if (!others.length) {
    return { answer: `Nothing besides ${statWords(ctx.stat)} stands out on ${ctx.last}'s board right now.`, breakdown: [] };
  }
  const rows = others.map((bet) => {
    const l10 = recentWindow(bet.read);
    const hit = l10 ? ` He has gone ${bet.side} in ${bet.side === 'over' ? l10.overs : l10.unders} of his last ${l10.games}.` : '';
    return `${bet.read.statWords} ${bet.side} ${bet.quote.line} at ${priceText(bet.quote)}.${hit}`;
  });
  return { answer: `I'd look at ${ctx.last} ${rows[0]}`, breakdown: rows.slice(1) };
}

function localShotReply(ctx: Ctx): AskReplyText {
  if (!ctx.shotProfile.length) return { answer: `No shot profile stored for ${ctx.last} yet.`, breakdown: [] };
  return { answer: ctx.shotProfile[0], breakdown: ctx.shotProfile.slice(1, 6) };
}

function localReply(ctx: Ctx): AskReplyText {
  if (ctx.intent === 'best_line') return localBestLineReply(ctx);
  if (ctx.intent === 'take') return localTakeReply(ctx);
  if (ctx.intent === 'other_markets') return localOtherMarketsReply(ctx);
  if (ctx.intent === 'shot') return localShotReply(ctx);
  return localModelReply(ctx);
}

function lineFromQuestion(question: string): number | null {
  const plus = question.match(/(?<![\d.])(\d{1,2})\s*\+/);
  if (plus) return Number(plus[1]) - 0.5;
  const half = question.match(/(?<![\d.])(\d{1,2}\.5)(?![\d])/);
  if (half) return Number(half[1]);
  const ou = question.match(/\b(?:over|under|o|u)\s*(\d{1,2}(?:\.\d)?)\b/i);
  return ou ? Number(ou[1]) : null;
}

async function loadDefence(season: number, opponentCode: string | null) {
  const out: Ctx['defence'] = {};
  if (!opponentCode) return out;
  const ste = await buildNbaSteStatsPayload({ year: season, window: 0 }).catch(() => null);
  if (!ste) return out;
  for (const [stat, metric] of Object.entries(ALLOWED_METRIC)) {
    if (!metric) continue;
    const block = ste.metrics[metric];
    const allows = block?.values?.[opponentCode];
    const rank = block?.ranks?.[opponentCode];
    out[stat] = allows != null && rank != null ? { allows, rank, of: Object.keys(block.ranks).length } : null;
  }
  return out;
}

async function loadShotProfile(player: string, teamCode: string | null, opponentCode: string | null, season: number) {
  const years = [season];
  const [mine, theirs] = await Promise.all([
    loadNbaPlayerShotChart(player, teamCode, years).catch(() => null),
    opponentCode ? loadNbaDefenseShotChart(opponentCode, years).catch(() => null) : Promise.resolve(null),
  ]);
  if (!mine || !mine.zones.length) return [];
  const makes = mine.zones.reduce((s, z) => s + z.fgm, 0);
  if (!makes) return [];
  const last = lastNameOf(player);
  return [...mine.zones]
    .sort((a, b) => b.fgm - a.fgm)
    .filter((z) => z.fgm > 0)
    .slice(0, 4)
    .map((z) => {
      const label = NBA_SHOT_ZONE_LABELS[z.zone as NbaShotZoneId] ?? z.zone;
      const share = Math.round((z.fgm / makes) * 100);
      const def = theirs?.ranks.find((r) => r.zone === z.zone);
      const vs =
        def?.rank != null
          ? ` ${clubName(opponentCode)} are shot-chart #${def.rank} of ${def.teamsCompared} defending the ${label.toLowerCase()}.`
          : '';
      return `${share}% of ${last}'s makes come from the ${label.toLowerCase()}.${vs}`;
    });
}

async function injuriesFor(teamCode: string | null, opponentCode: string | null, playerName: string) {
  const data = await loadNbaInjuries().catch(() => null);
  const rows = data?.injuries ?? [];
  const pick = (code: string | null) => {
    const name = code ? clubName(code) : '';
    if (!name) return [];
    return rows
      .filter((r) => r.team === name && r.player !== playerName)
      .map((r) => ({ player: r.player, status: r.injury || 'Out', returning: r.returning }));
  };
  return { teammatesOut: pick(teamCode), opponentOut: pick(opponentCode) };
}

const LENSES = [
  'hit rate versus this line',
  'last few games and streaks',
  'head to head versus current form',
  'teammates in or out',
  'minutes and role',
  'what this defence allows against his numbers',
  'shot profile against this defence',
] as const;

const NBA_RULES = `NBA basketball:
- No stat codes like PTS, REB, AST, 3PM, PRA, P+R, L5, L10, H2H, DNP or USG — write "points", "rebounds", "assists", "threes made", "points + rebounds + assists", "last 10", "head to head".
- Stats that matter: hit rates against the line (last 5, last 10, last 15, this season, against this opponent), over/under runs, averages, minutes and role, teammates out, head to head with how long ago, and what the opponent allows.
- focus is the market on the chart. focus.line is the book line unless the user named a number — then grade userLine first.
- Put his numbers beside what this opponent gives up (focus.opponentDefence). Defence rank 1 is the toughest of 30. A hard defence is not an automatic under, an easy one is not an automatic over.
- Hit rates are overs and unders at that exact line, like "over 24.5 points in 6 of his last 10 games". A push is neither.
- markets is every priced market for him this game, best decimal price per line with books. When they want a bet and rankedBets is filled, use rankedBets in its order. Otherwise choose from markets with a price.
- Milestone lines (10+, 20+ and so on) only offer the over.
- Do not volunteer a price under 1.50 unless they named that line. Quote a price once.
- Injuries: only name players listed in injuries. Never guess return dates beyond what is listed.
- Shot chart questions: quote "X% of makes" and shot-chart #N from shotProfile only. Shot-chart ranks are field goal % allowed in that zone; #1 is the toughest.
- NBA players are men: he / him.`;

const SYSTEM_PROMPT = buildAskSystemPrompt({ subject: 'this NBA game', sportRules: NBA_RULES });

function priceOffers(markets: Record<string, LineQuotes[]>): AskPriceOffer[] {
  const offers: AskPriceOffer[] = [];
  for (const rows of Object.values(markets)) {
    for (const r of rows) {
      if (r.over) offers.push({ side: 'over', line: r.line, price: r.over.price });
      if (r.under) offers.push({ side: 'under', line: r.line, price: r.under.price });
    }
  }
  return offers;
}

function buildPack(ctx: Ctx) {
  const form = playerForm(ctx.games, ctx.stat);
  const focusRows = ctx.markets[ctx.stat] ?? [];
  const atLine = focusRows.find((r) => r.line === ctx.line);
  const fair = (q: Quote | null | undefined) => (q && (ctx.lineFromUser || isFair(q)) ? q : null);
  return {
    game: { player: ctx.player, team: clubName(ctx.teamCode), opponent: clubName(ctx.opponentCode) },
    player: {
      name: ctx.player,
      pronouns: 'he / him / his / himself',
      gamesThisSeason: form.gamesThisSeason,
      averages: form.averages,
      lastGames: form.lastGames,
    },
    focus: {
      market: statWords(ctx.stat),
      line: ctx.line,
      lineIs: ctx.lineFromUser ? 'the number the user named' : 'the book line on the chart',
      hitRates: ctx.read?.windows ?? [],
      run: ctx.read?.run ?? null,
      bestOver: fair(atLine?.over),
      bestUnder: fair(atLine?.under),
      opponentDefence: defenceLine(ctx, ctx.stat),
    },
    userLine:
      ctx.lineFromUser && ctx.read
        ? { market: ctx.read.statWords, line: ctx.read.line, hitRates: ctx.read.windows, run: ctx.read.run }
        : null,
    timeline: form.timeline,
    h2h: headToHead(ctx.games, ctx.opponentCode, ctx.stat),
    rankedBets: ctx.ranked.slice(0, 3).map((bet, i) => ({
      rank: i + 1,
      market: bet.read.statWords,
      side: bet.side,
      line: bet.quote.line,
      price: bet.quote.price,
      books: bet.quote.books,
      hitRates: bet.read.windows,
      run: bet.read.run,
      opponentDefence: defenceLine(ctx, bet.stat),
    })),
    markets: Object.entries(ctx.markets).map(([stat, rows]) => {
      const main = mainLine(rows);
      return {
        market: statWords(stat),
        mainLine: main?.line ?? null,
        lines: rows
          .map((r) => ({ line: r.line, over: fair(r.over), under: fair(r.under), milestone: r.milestone }))
          .filter((r) => r.over || r.under),
        hitRatesAtMainLine: main ? readFor(ctx, stat, main.line)?.windows ?? [] : [],
        opponentDefence: defenceLine(ctx, stat),
      };
    }),
    injuries: ctx.injuries,
    shotProfile: ctx.shotProfile,
  };
}

function locksFor(ctx: Ctx): string[] {
  const words = statWords(ctx.stat);
  const locks = [
    ctx.lineFromUser && ctx.line != null
      ? `The user named ${ctx.line} ${words} for ${ctx.last}. Grade that number with his hit rates at ${ctx.line}.`
      : ctx.line != null
        ? `The chart is on ${ctx.last} ${words}, book line ${ctx.line}.`
        : `No book line for ${ctx.last} ${words} — talk about his form and say there is no line.`,
  ];
  if (ctx.intent === 'take' && ctx.ranked.length) {
    const [top, next] = ctx.ranked;
    locks.push(
      `They want THE best bet on ${ctx.last}, on any market. rankedBets is already ranked on his record at each line, priced ${MIN_DECIMAL.toFixed(2)} or more. Lead with rank 1: "I'd take ${betText(ctx, top)}" and the main reason.${
        next ? ` Then a sentence starting "I also like" with rank 2: ${betText(ctx, next)}, and its reason.` : ''
      } Keep this order and these exact lines and prices.`
    );
  } else if (ctx.intent === 'take') {
    locks.push(
      `They want THE best bet on ${ctx.last} on any market. Nothing priced ${MIN_DECIMAL.toFixed(2)} or more is clearly backed by his record, so either name the closest one with its price and why, or say you would pass.`
    );
  }
  if (ctx.intent === 'other_markets') locks.push(`They want a market other than ${words}. Pick from the rest of markets.`);
  if (ctx.intent === 'best_line') {
    locks.push('They asked for the best line. Lead with the best over and under price and book for that market, then say which side you would take or that you would pass, and why.');
  }
  locks.push(`${ctx.last} is a man. Refer to him as he / him / his.`);
  return locks;
}

export async function answerNbaAsk(opts: {
  question: string;
  playerId?: string | null;
  playerName?: string | null;
  opponent?: string | null;
  stat?: string | null;
  selectedLine?: number | null;
  history?: AskMessage[];
  allowLlm?: boolean;
  startedAt?: number;
}): Promise<NbaAskReply> {
  const intent = nbaQuestionIntent(opts.question);
  const player = String(opts.playerName || '').trim();
  const suggestions = nbaPunterQuestions(player, opts.opponent || '');
  const games = opts.playerId ? await loadNbaPlayerGameLogs(opts.playerId, NBA_CHART_HISTORY_YEARS) : [];
  const latest = playedGames(games).at(-1) ?? games.at(-1);
  const teamCode = latest?.teamCode ?? null;
  const opponentCode = resolveNbaClub(opts.opponent || '')?.code ?? (nbaTeamCode(opts.opponent || '') || null);
  const season = await resolveNbaDataSeason();

  const oddsCache = await getNbaOddsCache().catch(() => null);
  const oddsGame =
    teamCode && oddsCache ? findNbaOddsGame(oddsCache.games ?? [], clubName(teamCode), clubName(opponentCode)) : null;
  const byStat = oddsGame && player ? nbaPlayerPropsByStat(oddsGame, player) : {};
  const markets: Record<string, LineQuotes[]> = {};
  for (const [stat, books] of Object.entries(byStat)) {
    if (!NBA_ASK_STAT_WORDS[stat]) continue;
    const rows = marketLines(books);
    if (rows.length) markets[stat] = rows;
  }

  const [defence, shotProfile, injuries] = await Promise.all([
    loadDefence(season, opponentCode),
    loadShotProfile(player, teamCode, opponentCode, season),
    injuriesFor(teamCode, opponentCode, player),
  ]);

  const named = nbaStatFromQuestion(opts.question);
  const stat = named || opts.stat || 'points';
  const userLine = lineFromQuestion(opts.question);
  const chartLine =
    stat === (opts.stat || 'points') && opts.selectedLine != null && Number.isFinite(Number(opts.selectedLine))
      ? Number(opts.selectedLine)
      : null;
  const line = userLine ?? chartLine ?? mainLine(markets[stat] ?? [])?.line ?? null;
  const ctx: Ctx = {
    intent,
    games,
    player,
    last: lastNameOf(player),
    teamCode,
    opponentCode,
    stat,
    line,
    lineFromUser: userLine != null,
    read: null,
    markets,
    ranked: [],
    defence,
    shotProfile,
    injuries,
  };
  ctx.ranked = rankBets(ctx);
  if (intent === 'take' && !named && userLine == null && ctx.ranked[0]) {
    ctx.stat = ctx.ranked[0].stat;
    ctx.line = ctx.ranked[0].quote.line;
  }
  ctx.read = readFor(ctx, ctx.stat, ctx.line);

  const local = localReply(ctx);
  if (!games.length) return { ...local, source: 'stats', suggestions };
  const pack = buildPack(ctx);
  const reply = await runAskAi({
    sportModel: process.env.NBA_ASK_MODEL,
    system: SYSTEM_PROMPT,
    userContent: buildAskUserContent({
      locks: locksFor(ctx),
      lens: LENSES[Math.floor(Math.random() * LENSES.length)],
      pack,
      question: opts.question,
    }),
    history: opts.history,
    question: opts.question,
    pack,
    local,
    allowLlm: opts.allowLlm,
    startedAt: opts.startedAt,
    checks: [
      (r) => (/\b(she|her|hers|herself)\b/i.test(askReplyText(r)) ? `${ctx.last} is a man. Use he / him / his.` : null),
      (r) =>
        ctx.intent === 'take' && !ctx.lineFromUser && /\b1\.[0-4]\d\b/.test(askReplyText(r))
          ? `That price is under ${MIN_DECIMAL.toFixed(2)}. Pick a market priced ${MIN_DECIMAL.toFixed(2)} or more, or pass.`
          : null,
      askPriceCheck(priceOffers(markets)),
      (r) => {
        const bad = nbaAverageMismatches(askReplyText(r), pack);
        return bad.length
          ? `These averages don't match the market or window in their sentence: ${bad.map((b) => `"${b}"`).join('; ')}. player.averages has last5, last10 and thisSeason for every market (points, points + rebounds, points + rebounds + assists and so on); quote the number from the matching market and window.`
          : null;
      },
    ],
  });
  return { ...reply, suggestions };
}
