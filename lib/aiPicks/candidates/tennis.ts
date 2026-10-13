/**
 * Tennis candidates: every line any book prices for the match, oriented home (player A) vs away,
 * priced by the tennis model's point-level simulation and checked against the de-vigged market.
 */

import type { AiPickMarketKind, AiPickSide } from '@/lib/aiPicks/types';
import type { TennisMarket } from '@/lib/aiPicks/markets';
import { coherentPair, evPerUnit, fairTwoWay, median, round } from '@/lib/aiPicks/model/math';
import { anchorSimulation } from '@/lib/aiPicks/model/tennisAnchor';
import type { TennisContext } from '@/lib/aiPicks/model/tennisContext';
import { effectiveModelWeight, type AiTennisParams } from '@/lib/aiPicks/params';
import {
  BLOCKING_FLAG,
  bestQuote,
  candidateKey,
  edgeFlag,
  eligibility,
  type AiCandidate,
  type CandidateQuote,
  type SupportRecord,
} from '@/lib/aiPicks/candidates/types';
import { tennisResultFromRow } from '@/lib/aiPicks/grade/tennis';
import { tennisMatchesPlayed } from '@/lib/tennis/chartStats';
import { tennisOuLinePlausible, type TennisBookRow, type TennisOuLine } from '@/lib/tennis/oddsTypes';
import type { TennisMatchRow } from '@/lib/tennis/types';
import { decimalFromBook } from '@/lib/tennisAi/availability';
import type { MatchupFeatures } from '@/lib/tennisAi/features';
import { sideProb, winASetProb } from '@/lib/tennisAi/pack';
import { probOverHist, type SimSummary } from '@/lib/tennisAi/simulate';
import type { AvailableMarket, MarketKey, SelectionSide } from '@/lib/tennisAi/types';

export type TennisMatchRef = {
  matchId: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
  startsAt: string;
  surface: string;
  bestOf: 3 | 5;
  tournament: string | null;
};

type Who = 'home' | 'away' | 'match';

/** One selection across books. `pairKey` groups it with its opposite side for de-vigging. */
type TennisSelection = {
  market: TennisMarket;
  who: Who;
  side: AiPickSide;
  line: number | null;
  pairKey: string;
  /** true for the side whose fair probability is the first of the pair. */
  first: boolean;
  quotes: CandidateQuote[];
};

const num = (s: string | null | undefined) => {
  const n = Number.parseFloat(String(s ?? '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const halfPoint = (n: number) => Math.abs(Math.abs(n) % 1 - 0.5) < 0.01;

function rowsOf(single: TennisOuLine | undefined, many: TennisOuLine[] | undefined): TennisOuLine[] {
  if (many?.length) return many;
  return single && single.line !== 'N/A' ? [single] : [];
}

/** Every priced side, keyed so the two halves of a book's pair can be matched later. */
export function tennisSelections(books: TennisBookRow[]): { selections: TennisSelection[]; pairs: Map<string, Map<string, [number | null, number | null]>> } {
  const sels = new Map<string, TennisSelection>();
  const pairs = new Map<string, Map<string, [number | null, number | null]>>();
  const add = (s: Omit<TennisSelection, 'quotes'>, book: string, price: number | null) => {
    if (price == null || !(price > 1)) return;
    const key = `${s.market}|${s.who}|${s.side}|${s.line ?? ''}`;
    const hit = sels.get(key) ?? { ...s, quotes: [] };
    hit.quotes.push({ book, price });
    sels.set(key, hit);
  };
  /** Both halves of one book's two-way price; an incoherent pair is dropped whole. */
  const both = (
    first: Omit<TennisSelection, 'quotes' | 'first'>,
    second: Omit<TennisSelection, 'quotes' | 'first'>,
    book: string,
    a: number | null,
    b: number | null
  ) => {
    if (!coherentPair(a, b)) return;
    add({ ...first, first: true }, book, a);
    add({ ...second, first: false }, book, b);
    const byBook = pairs.get(first.pairKey) ?? new Map();
    byBook.set(book, [a, b]);
    pairs.set(first.pairKey, byBook);
  };
  const ou = (book: string, market: TennisMarket, who: Who, stat: string, rows: TennisOuLine[]) => {
    for (const row of rows) {
      const line = num(row.line);
      if (line == null || !halfPoint(line) || !tennisOuLinePlausible(stat, line)) continue;
      const pairKey = `${market}|${who}|${line}`;
      both(
        { market, who, side: 'over', line, pairKey },
        { market, who, side: 'under', line, pairKey },
        book,
        decimalFromBook(row.over),
        decimalFromBook(row.under)
      );
    }
  };
  const sets = (book: string, who: 'home' | 'away', rows: TennisOuLine[]) => {
    for (const row of rows) {
      const line = num(row.line);
      if (line == null || !halfPoint(line) || !tennisOuLinePlausible('setsWon', line)) continue;
      const over = decimalFromBook(row.over);
      const under = decimalFromBook(row.under);
      if (line === 0.5) {
        const pairKey = `win_a_set|${who}`;
        both(
          { market: 'win_a_set', who, side: 'yes', line: null, pairKey },
          { market: 'win_a_set', who, side: 'no', line: null, pairKey },
          book,
          over,
          under
        );
      } else {
        const pairKey = `player_sets|${who}|${line}`;
        both(
          { market: 'player_sets', who, side: 'over', line, pairKey },
          { market: 'player_sets', who, side: 'under', line, pairKey },
          book,
          over,
          under
        );
      }
    }
  };

  for (const b of books) {
    both(
      { market: 'match_winner', who: 'home', side: 'yes', line: null, pairKey: 'match_winner' },
      { market: 'match_winner', who: 'away', side: 'yes', line: null, pairKey: 'match_winner' },
      b.name,
      decimalFromBook(b.H2H?.home),
      decimalFromBook(b.H2H?.away)
    );

    for (const row of rowsOf(b.Spread, b.SpreadLines)) {
      const line = num(row.line);
      if (line == null || !halfPoint(line) || !tennisOuLinePlausible('spread', line)) continue;
      const pairKey = `game_handicap|${line}`;
      both(
        { market: 'game_handicap', who: 'home', side: 'yes', line, pairKey },
        { market: 'game_handicap', who: 'away', side: 'yes', line: -line, pairKey },
        b.name,
        decimalFromBook(row.over),
        decimalFromBook(row.under)
      );
    }
    ou(b.name, 'total_games', 'match', 'totalGames', rowsOf(b.Total, b.TotalLines));
    ou(b.name, 'player_games', 'home', 'gamesWon', rowsOf(b.GamesWon, b.GamesWonLines));
    ou(b.name, 'player_games', 'away', 'gamesLost', rowsOf(b.GamesLost, b.GamesLostLines));
    ou(b.name, 'total_sets', 'match', 'totalSets', rowsOf(b.TotalSets, b.TotalSetsLines));
    sets(b.name, 'home', rowsOf(b.SetsWon, b.SetsWonLines));
    sets(b.name, 'away', rowsOf(b.SetsLost, b.SetsLostLines));
  }
  return { selections: [...sels.values()], pairs };
}

/** Median fair probability of the selection's side across books pricing both halves. */
function marketFair(sel: TennisSelection, pairs: Map<string, Map<string, [number | null, number | null]>>): number | null {
  const fairs: number[] = [];
  for (const [a, b] of pairs.get(sel.pairKey)?.values() ?? []) {
    if (a == null || b == null) continue;
    const fair = fairTwoWay(a, b);
    if (fair) fairs.push(sel.first ? fair[0] : fair[1]);
  }
  return median(fairs);
}

function fakeMarket(key: MarketKey, selection: SelectionSide, line: number | null): AvailableMarket {
  return {
    key,
    name: key,
    selection,
    opposite: selection,
    line,
    score: null,
    model: 'simulation',
    priceable: true,
    stale: false,
    featured: false,
    quotes: [],
    oppositeQuotes: [],
    best: null,
    bestOpposite: null,
  };
}

/** Model probability the selection wins, and of a push. */
export function tennisModelProb(
  sel: Pick<TennisSelection, 'market' | 'who' | 'side' | 'line'>,
  sim: SimSummary,
  features: MatchupFeatures
): { prob: number; push: number } | null {
  const over = sel.side === 'over' || sel.side === 'yes';
  const hist = (h: number[], line: number) => {
    const p = probOverHist(h, line);
    return { prob: over ? p.over : p.under, push: p.push };
  };
  switch (sel.market) {
    case 'match_winner': {
      const r = sideProb(fakeMarket('MATCH_WINNER', sel.who === 'home' ? 'PLAYER' : 'OPPONENT', null), sim, features);
      return r ? { prob: r.prob, push: 0 } : null;
    }
    case 'game_handicap': {
      if (sel.line == null) return null;
      const r = sideProb(fakeMarket('GAME_HANDICAP', sel.who === 'home' ? 'PLAYER' : 'OPPONENT', sel.line), sim, features);
      return r ? { prob: r.prob, push: r.pushProb } : null;
    }
    case 'total_games':
      return sel.line == null ? null : hist(sim.totalGames, sel.line);
    case 'player_games':
      return sel.line == null ? null : hist(sel.who === 'home' ? sim.gamesA : sim.gamesB, sel.line);
    case 'total_sets':
      return sel.line == null ? null : hist(sim.setsPlayed, sel.line);
    case 'win_a_set': {
      const yes = winASetProb(sim, sel.who === 'home' ? 'PLAYER' : 'OPPONENT');
      return yes == null ? null : { prob: over ? yes : 1 - yes, push: 0 };
    }
    case 'player_sets': {
      if (sel.line == null) return null;
      let p = 0;
      for (const [score, prob] of Object.entries(sim.setScores)) {
        const [a, b] = score.split('-').map(Number);
        const won = sel.who === 'home' ? a : b;
        if (Number.isFinite(won) && won! > sel.line) p += prob;
      }
      return { prob: over ? p : 1 - p, push: 0 };
    }
  }
}

type Results = { won: boolean; gamesWon: number; gamesLost: number; setsWon: number; setsLost: number };

function recentResults(rows: TennisMatchRow[], n = 10): Results[] {
  return tennisMatchesPlayed(rows)
    .filter((r) => !/ret|w\/o|def/i.test(String(r.score || '')))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
    .slice(-n)
    .map((r) => tennisResultFromRow(r))
    .filter((r): r is NonNullable<typeof r> => r != null);
}

function record(label: string, list: Results[], hit: (r: Results) => boolean): SupportRecord | null {
  return list.length ? { label, hits: list.filter(hit).length, games: list.length } : null;
}

/** How often each player's recent matches would have landed this selection. */
export function tennisSupport(
  sel: Pick<TennisSelection, 'market' | 'who' | 'side' | 'line'>,
  logs: { home: TennisMatchRow[]; away: TennisMatchRow[] },
  names: { home: string; away: string }
): SupportRecord[] {
  const yes = sel.side === 'over' || sel.side === 'yes';
  const line = sel.line ?? 0;
  const mine = sel.who === 'away' ? logs.away : logs.home;
  const theirs = sel.who === 'away' ? logs.home : logs.away;
  const me = sel.who === 'away' ? names.away : names.home;
  const them = sel.who === 'away' ? names.home : names.away;
  const flip = (b: boolean) => (yes ? b : !b);
  const recMine = recentResults(mine);
  const recTheirs = recentResults(theirs);
  const out: Array<SupportRecord | null> = [];
  switch (sel.market) {
    case 'match_winner':
      out.push(record(`${me} last 10`, recMine, (r) => r.won), record(`${them} last 10 (losses)`, recTheirs, (r) => !r.won));
      break;
    case 'win_a_set':
      out.push(record(`${me} won a set, last 10`, recMine, (r) => flip(r.setsWon >= 1)), record(`${them} dropped a set, last 10`, recTheirs, (r) => flip(r.setsLost >= 1)));
      break;
    case 'game_handicap':
      out.push(record(`${me} covered ${line > 0 ? '+' : ''}${line}, last 10`, recMine, (r) => r.gamesWon - r.gamesLost + line > 0));
      break;
    case 'player_sets':
      out.push(record(`${me} sets ${yes ? 'over' : 'under'} ${line}, last 10`, recMine, (r) => flip(r.setsWon > line)));
      break;
    case 'player_games':
      out.push(record(`${me} games ${yes ? 'over' : 'under'} ${line}, last 10`, recMine, (r) => flip(r.gamesWon > line)), record(`${them} conceded ${yes ? 'over' : 'under'} ${line}, last 10`, recTheirs, (r) => flip(r.gamesLost > line)));
      break;
    case 'total_games':
      out.push(record(`${names.home} matches ${yes ? 'over' : 'under'} ${line} games`, recentResults(logs.home), (r) => flip(r.gamesWon + r.gamesLost > line)), record(`${names.away} matches ${yes ? 'over' : 'under'} ${line} games`, recentResults(logs.away), (r) => flip(r.gamesWon + r.gamesLost > line)));
      break;
    case 'total_sets':
      out.push(record(`${names.home} matches ${yes ? 'over' : 'under'} ${line} sets`, recentResults(logs.home), (r) => flip(r.setsWon + r.setsLost > line)), record(`${names.away} matches ${yes ? 'over' : 'under'} ${line} sets`, recentResults(logs.away), (r) => flip(r.setsWon + r.setsLost > line)));
      break;
  }
  return out.filter((r): r is SupportRecord => r != null);
}

function supportScore(records: SupportRecord[]): number | null {
  const used = records.filter((r) => r.games >= 3);
  if (!used.length) return null;
  return round(used.reduce((s, r) => s + r.hits / r.games, 0) / used.length, 3);
}

/** Main line for an over/under or handicap market: the line whose fair price is closest to 50/50. */
function mainLines(selections: TennisSelection[], pairs: Map<string, Map<string, [number | null, number | null]>>): Set<string> {
  const best = new Map<string, { pairKey: string; gap: number }>();
  for (const sel of selections) {
    if (sel.line == null || !sel.first) continue;
    const fair = marketFair(sel, pairs);
    if (fair == null) continue;
    const group = `${sel.market}|${sel.who}`;
    const gap = Math.abs(fair - 0.5);
    const prev = best.get(group);
    if (!prev || gap < prev.gap) best.set(group, { pairKey: sel.pairKey, gap });
  }
  return new Set([...best.values()].map((b) => b.pairKey));
}

export function buildTennisCandidates(input: {
  match: TennisMatchRef;
  books: TennisBookRow[];
  sim: SimSummary;
  features: MatchupFeatures;
  logs: { home: TennisMatchRow[]; away: TennisMatchRow[] };
  params: AiTennisParams;
  /** Re-simulate every market but match winner at the blended match-winner probability. */
  anchor?: { sims: number; seed: number };
  /** Surface/opponent-adjusted serve rates and the full match-winner blend. */
  context?: TennisContext;
  /** Recent stat lines per player for the review. */
  evidence?: { home: unknown; away: unknown };
}): AiCandidate[] {
  const { match, features, params, context: tc } = input;
  const sim = tc?.sim ?? input.sim;
  const { selections, pairs } = tennisSelections(input.books);
  const mains = mainLines(selections, pairs);
  const names = { home: match.homeName, away: match.awayName };
  const sample = Math.min(features.player.n, features.opponent.n);

  const winSel = selections.find((s) => s.market === 'match_winner' && s.who === 'home');
  const fairHome = winSel ? marketFair(winSel, pairs) : null;
  const baseHome = tc ? (tennisModelProb({ market: 'match_winner', who: 'home', side: 'yes', line: null }, input.sim, features)?.prob ?? null) : null;
  const modelHome = tc?.winProb ?? tennisModelProb({ market: 'match_winner', who: 'home', side: 'yes', line: null }, sim, features)?.prob ?? null;
  const wWin = effectiveModelWeight(params.modelWeight.match_winner ?? 0.3, sample, params.sampleHalfLife);
  const anchored =
    input.anchor && fairHome != null && modelHome != null
      ? anchorSimulation(
          {
            pA: tc?.pA ?? features.pServePlayer,
            pB: tc?.pB ?? features.pServeOpponent,
            bestOf: match.bestOf,
            uncertainty: Math.hypot(features.serveUncertainty, params.dayForm),
          },
          wWin * modelHome + (1 - wWin) * fairHome,
          input.anchor
        )
      : null;
  const baseFlags: string[] = [];
  if (features.insufficient) baseFlags.push('Not enough match history for the model');
  if (features.player.retiredRecent) baseFlags.push(`${match.homeName} retired in their last match`);
  if (features.opponent.retiredRecent) baseFlags.push(`${match.awayName} retired in their last match`);
  const out: AiCandidate[] = [];

  for (const sel of selections) {
    const picked = bestQuote(sel.quotes);
    const model =
      sel.market === 'match_winner' && tc
        ? { prob: sel.who === 'home' ? tc.winProb : 1 - tc.winProb, push: 0 }
        : tennisModelProb(sel, sel.market === 'match_winner' || !anchored ? sim : anchored.sim, features);
    if (!picked || !model) continue;
    const fair = marketFair(sel, pairs);
    const w = effectiveModelWeight(params.modelWeight[sel.market] ?? 0.3, sample, params.sampleHalfLife);
    const prob = fair == null ? model.prob : w * model.prob + (1 - w) * fair;
    const flags = [...baseFlags, ...picked.flags];
    if (fair == null) flags.push('Only one side is priced, so the market cannot be checked');
    else if (Math.abs(model.prob - fair) > params.maxModelMarketGap) flags.push(`Model and market differ by ${Math.round(Math.abs(model.prob - fair) * 100)}%`);
    const support = tennisSupport(sel, input.logs, names);
    const score = supportScore(support);
    if (score != null && score < params.minSupport) flags.push('Thin support in recent matches');
    if (picked.best.price > params.maxPriceSingle) flags.push('Long shot');
    const ev = evPerUnit(prob, picked.best.price, model.push);
    const edge = edgeFlag(ev, params.maxTrustedEv);
    if (edge) flags.push(edge);
    const blocked = flags.some((f) => BLOCKING_FLAG.test(f));
    const marketKind: AiPickMarketKind = sel.line == null || mains.has(sel.pairKey) ? 'main' : 'alternate';
    const player = sel.who === 'away' ? match.awayName : sel.who === 'home' ? match.homeName : null;
    const playerId = sel.who === 'away' ? match.awayId : match.homeId;
    const opponent = sel.who === 'away' ? match.homeName : match.awayName;
    const c: AiCandidate = {
      key: '',
      sport: 'tennis',
      eventKey: match.matchId,
      eventLabel: `${match.homeName} vs ${match.awayName}`,
      startsAt: match.startsAt,
      market: sel.market,
      marketKind,
      player,
      playerId,
      team: opponent,
      side: sel.side,
      line: sel.line,
      bestPrice: picked.best.price,
      bestBook: picked.best.book,
      quotes: sel.quotes.sort((a, b) => b.price - a.price),
      modelProb: round(model.prob),
      marketProb: fair == null ? null : round(fair),
      contextProbs:
        sel.market === 'match_winner' && tc && baseHome != null
          ? {
              base: round(sel.who === 'home' ? baseHome : 1 - baseHome),
              full: round(sel.who === 'home' ? tc.fullWinProb : 1 - tc.fullWinProb),
            }
          : null,
      prob: round(prob),
      pushProb: round(model.push),
      ev: round(ev),
      projection: null,
      support,
      supportScore: score,
      ...eligibility(picked.best.price, marketKind, blocked, params),
      flags,
      context: {
        surface: match.surface,
        bestOf: match.bestOf,
        tournament: match.tournament,
        modelWeight: round(w),
        serve: { home: round(tc?.pA ?? features.pServePlayer), away: round(tc?.pB ?? features.pServeOpponent) },
        baseServe: tc ? { home: round(features.pServePlayer), away: round(features.pServeOpponent) } : undefined,
        serveReturn: tc?.serve,
        winParts: tc?.parts,
        notes: tc?.notes,
        anchorShift: anchored ? round(anchored.shift) : null,
        form: { home: features.player.form, away: features.opponent.form },
        h2h: { homeWins: features.h2hWins, played: features.h2hPlayed },
        elo: {
          home: { overall: Math.round(features.player.elo), surface: Math.round(features.player.surfaceElo) },
          away: { overall: Math.round(features.opponent.elo), surface: Math.round(features.opponent.surfaceElo) },
        },
        rest: {
          home: { days: features.player.restDays == null ? null : Math.round(features.player.restDays), minutes14: Math.round(features.player.minutes14) },
          away: { days: features.opponent.restDays == null ? null : Math.round(features.opponent.restDays), minutes14: Math.round(features.opponent.minutes14) },
        },
        evidence: input.evidence,
      },
    };
    out.push({ ...c, key: candidateKey({ ...c, player: player ?? match.homeName }) });
  }
  return out;
}
