/**
 * NBL candidates: every player prop line (main, alternate, milestone) and game line any book
 * prices, run through the models and the de-vigged market.
 */

import type { AiPickMarketKind, AiPickSide } from '@/lib/aiPicks/types';
import { isNblPropMarket, type NblPropMarket } from '@/lib/aiPicks/markets';
import {
  clamp,
  countSideProbs,
  coherentPair,
  evPerUnit,
  fairOneWay,
  fairTwoWay,
  impliedCountMean,
  median,
  round,
  winShare,
  type SideProbs,
} from '@/lib/aiPicks/model/math';
import {
  nblPropSideProbs,
  nblPropSupport,
  projectNblProp,
  supportScore,
  type NblPropProjection,
} from '@/lib/aiPicks/model/nblProps';
import {
  adjustNblGame,
  nblH2hProb,
  nblSpreadProbs,
  nblTotalProbs,
  projectNblGame,
  type NblFinal,
  type NblGameContext,
  type NblGameProjection,
} from '@/lib/aiPicks/model/nblGames';
import { nblPlayerEvidence, type NblInjuryContext, type NblPropContext } from '@/lib/aiPicks/model/nblContext';
import { effectiveModelWeight, type AiSportParams } from '@/lib/aiPicks/params';
import {
  BLOCKING_FLAG,
  bettableQuote,
  candidateKey,
  distinctPrices,
  edgeFlag,
  eligibility,
  type AiCandidate,
  type CandidateQuote,
} from '@/lib/aiPicks/candidates/types';
import { consensusLine } from '@/lib/nbl/lineMovement';
import { nblPlayerPropGameKey, type NblSnapLine } from '@/lib/nbl/playerPropSnapshots';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import type { NblGameOdds } from '@/lib/nbl/oddsTypes';
import { decimalFromBook } from '@/lib/tennisAi/availability';

export type NblGameRef = { homeTeam: string; awayTeam: string; commenceTime: string };

export type NblResolvedPlayer = { playerId: string; name: string; team: string; games: NblGameLogRow[] };

const STALE_PLAYER_DAYS = 21;

export function nblEventLabel(g: NblGameRef): string {
  return `${g.awayTeam} @ ${g.homeTeam}`;
}

function blend(model: SideProbs, market: SideProbs, w: number): SideProbs {
  const mix = (a: number, b: number) => w * a + (1 - w) * b;
  return { over: mix(model.over, market.over), under: mix(model.under, market.under), push: mix(model.push, market.push) };
}

function sideWin(p: SideProbs, side: AiPickSide): number {
  return side === 'under' || side === 'away' ? p.under : p.over;
}

/** Fair P(over) at a line: median across books that price both sides there. */
function marketOverAt(lines: NblSnapLine[], line: number): number | null {
  const fairs = lines
    .filter((l) => l.kind === 'ou' && l.line === line && l.overDecimal && l.underDecimal && coherentPair(l.overDecimal, l.underDecimal))
    .map((l) => fairTwoWay(l.overDecimal!, l.underDecimal!)?.[0])
    .filter((p): p is number => p != null);
  return median(fairs);
}

type PropSelection = { line: number; kind: 'ou' | 'milestone'; side: 'over' | 'under'; quotes: CandidateQuote[] };

function propSelections(lines: NblSnapLine[]): PropSelection[] {
  const map = new Map<string, PropSelection>();
  const add = (line: number, kind: 'ou' | 'milestone', side: 'over' | 'under', book: string, price: number | null) => {
    if (price == null || !(price > 1)) return;
    const key = `${kind}|${line}|${side}`;
    const sel = map.get(key) ?? { line, kind, side, quotes: [] };
    sel.quotes.push({ book, price });
    map.set(key, sel);
  };
  for (const l of lines) {
    if (l.kind === 'ou' && !coherentPair(l.overDecimal, l.underDecimal)) continue;
    add(l.line, l.kind, 'over', l.book, l.overDecimal);
    if (l.kind === 'ou') add(l.line, l.kind, 'under', l.book, l.underDecimal);
  }
  return [...map.values()];
}

/**
 * Market mean for the stat (context and alternate lines with no two-way price). Two-way main line
 * first; with only milestones, the milestone nearest our projection.
 */
function marketMean(
  lines: NblSnapLine[],
  proj: NblPropProjection,
  oneWayPower: number
): { mean: number; mainLine: number | null; source: 'main' | 'milestone' } | null {
  const twoWay = lines.filter((l) => l.kind === 'ou' && l.overDecimal && l.underDecimal);
  const mainLine = consensusLine(twoWay.map((l) => l.line));
  if (mainLine != null) {
    const pOver = marketOverAt(lines, mainLine);
    if (pOver != null) return { mean: impliedCountMean(pOver, mainLine, proj.dispersion), mainLine, source: 'main' };
  }
  const milestones = lines.filter((l) => l.kind === 'milestone' && l.overDecimal);
  if (!milestones.length) return null;
  const near = [...milestones].sort((a, b) => Math.abs(a.line - proj.mean) - Math.abs(b.line - proj.mean))[0]!;
  const nearQuotes = milestones.filter((l) => l.line === near.line).map((l) => ({ book: l.book, price: l.overDecimal! }));
  const pOver = median(distinctPrices(nearQuotes).map((p) => fairOneWay(p, oneWayPower) ?? NaN));
  if (pOver == null) return null;
  return { mean: impliedCountMean(clamp(pOver, 0.02, 0.98), near.line, proj.dispersion), mainLine: null, source: 'milestone' };
}

/**
 * The market at this exact line: two-way price with the margin removed, or for a milestone its
 * own one-way price. Only an alternate line nobody prices both ways falls back to the fitted mean.
 */
function marketProbsAt(
  sel: PropSelection,
  lines: NblSnapLine[],
  mkt: { mean: number; source: 'main' | 'milestone' },
  proj: NblPropProjection,
  oneWayPower: number
): SideProbs | null {
  const fitted = countSideProbs(mkt.mean, mkt.mean * proj.dispersion, sel.line);
  if (sel.kind === 'milestone') {
    const over = median(sel.side === 'over' ? distinctPrices(sel.quotes).map((p) => fairOneWay(p, oneWayPower) ?? NaN) : []);
    return over == null ? null : { over, under: 1 - over, push: 0 };
  }
  const pOver = marketOverAt(lines, sel.line);
  if (pOver != null) return { over: pOver * (1 - fitted.push), under: (1 - pOver) * (1 - fitted.push), push: fitted.push };
  return mkt.source === 'main' ? fitted : null;
}

export type NblPropGameContext = {
  /** Game-specific adjustment for one stat (matchup, pace, teammates out, ...). */
  forStat: (stat: NblPropMarket) => NblPropContext;
  /** The player's own injury-list entry, if any. */
  listed: NblInjuryContext | null;
  /** Shared facts for the review (team/opponent ratings, who is out on each side). */
  facts: Record<string, unknown>;
};

export function buildNblPropCandidates(input: {
  game: NblGameRef;
  lines: NblSnapLine[];
  player: NblResolvedPlayer;
  opponent: string;
  params: AiSportParams;
  currentSeason: number;
  nowMs: number;
  context?: NblPropGameContext;
}): AiCandidate[] {
  const { game, player, params } = input;
  const eventKey = nblPlayerPropGameKey(game.homeTeam, game.awayTeam, game.commenceTime);
  const out: AiCandidate[] = [];
  const byStat = new Map<NblPropMarket, NblSnapLine[]>();
  for (const l of input.lines) {
    if (!isNblPropMarket(l.stat)) continue;
    byStat.set(l.stat, [...(byStat.get(l.stat) ?? []), l]);
  }

  for (const [stat, lines] of byStat) {
    const base = projectNblProp(player.games, stat, { currentSeason: input.currentSeason });
    if (!base) continue;
    const ctx = input.context?.forStat(stat) ?? { factors: [], total: 1, fullTotal: 1 };
    const scaled = (t: number): NblPropProjection => ({ ...base, mean: round(base.mean * t, 2), variance: round(base.variance * t, 2) });
    const proj = scaled(ctx.total);
    const fullProj = scaled(ctx.fullTotal);
    const mkt = marketMean(lines, proj, params.oneWayMarginPower);
    if (!mkt) continue;
    const baseFlags: string[] = [];
    const listed = input.context?.listed;
    if (listed) baseFlags.push(/out/i.test(listed.status) ? `Listed out on the injury report (${listed.status})` : `On the injury report (${listed.status})`);
    if (proj.currentSeasonGames < 2) baseFlags.push('Fewer than 2 games this season');
    const lastMs = Date.parse(String(proj.lastGameDate || ''));
    if (Number.isFinite(lastMs) && input.nowMs - lastMs > STALE_PLAYER_DAYS * 86_400_000) {
      baseFlags.push(`Has not played since ${String(proj.lastGameDate).slice(0, 10)}`);
    }
    if (mkt.source === 'milestone') baseFlags.push('No over/under posted yet');

    for (const sel of propSelections(lines)) {
      const picked = bettableQuote(sel.quotes);
      if (!picked) continue;
      const model = nblPropSideProbs(proj, sel.line);
      const market = marketProbsAt(sel, lines, mkt, proj, params.oneWayMarginPower);
      if (!market) continue;
      const kindKey = sel.kind === 'milestone' ? 'milestone' : 'prop';
      const w = effectiveModelWeight(params.modelWeight[kindKey] ?? 0.4, proj.sample, params.sampleHalfLife);
      const mixed = blend(model, market, w);
      const prob = sideWin(mixed, sel.side);
      const ev = evPerUnit(prob, picked.best.price, mixed.push);
      const marketKind: AiPickMarketKind =
        sel.kind === 'milestone' ? 'milestone' : mkt.mainLine != null && sel.line === mkt.mainLine ? 'main' : 'alternate';
      const support = nblPropSupport(player.games, stat, sel.line, sel.side, {
        currentSeason: input.currentSeason,
        opponent: input.opponent,
      });
      const score = supportScore(support);
      const flags = [...baseFlags, ...picked.flags];
      const gap = Math.abs(winShare(model, sel.side) - winShare(market, sel.side));
      if (gap > params.maxModelMarketGap) flags.push(`Model and market differ by ${Math.round(gap * 100)}%`);
      if (score != null && score < params.minSupport) flags.push('Thin support in the game logs');
      if (picked.best.price > params.maxPriceSingle) flags.push('Long shot');
      const edge = edgeFlag(ev, params.maxTrustedEv);
      if (edge) flags.push(edge);
      const blocked = flags.some((f) => BLOCKING_FLAG.test(f));
      out.push(
        withKey({
          key: '',
          sport: 'nbl',
          eventKey,
          eventLabel: nblEventLabel(game),
          startsAt: game.commenceTime,
          market: stat,
          marketKind,
          player: player.name,
          playerId: player.playerId,
          team: player.team,
          side: sel.side,
          line: sel.line,
          bestPrice: picked.best.price,
          bestBook: picked.best.book,
          quotes: picked.quotes,
          modelProb: round(sideWin(model, sel.side)),
          marketProb: round(sideWin(market, sel.side)),
          contextProbs: input.context
            ? {
                base: round(sideWin(nblPropSideProbs(base, sel.line), sel.side)),
                full: round(sideWin(nblPropSideProbs(fullProj, sel.line), sel.side)),
              }
            : null,
          prob: round(prob),
          pushProb: round(mixed.push),
          ev: round(ev),
          projection: proj.mean,
          support,
          supportScore: score,
          ...eligibility(picked.best.price, marketKind, blocked, params),
          flags,
          context: {
            projection: proj,
            baseProjection: base.mean,
            adjustment: ctx.total,
            factors: ctx.factors,
            marketMean: round(mkt.mean, 2),
            marketSource: mkt.source,
            mainLine: mkt.mainLine,
            modelWeight: round(w),
            opponent: input.opponent,
            evidence: nblPlayerEvidence(player.games, stat, input.currentSeason),
            facts: input.context?.facts,
          },
        })
      );
    }
  }
  return out;
}

function withKey(c: AiCandidate): AiCandidate {
  return { ...c, key: candidateKey(c) };
}

type GameQuote = { book: string; price: number; otherPrice: number | null; line: number | null };

function gameQuotes(odds: NblGameOdds) {
  const h2hHome: GameQuote[] = [];
  const h2hAway: GameQuote[] = [];
  const spreads: Array<{ book: string; homeLine: number; home: number | null; away: number | null; main: boolean }> = [];
  const totals: Array<{ book: string; line: number; over: number | null; under: number | null; main: boolean }> = [];
  type Row = { line: string; over: string; under: string };
  const pairs = (main: Row | undefined, all: Row[] | undefined) => {
    const mainLine = Number.parseFloat(String(main?.line));
    const out = new Map<number, { a: number | null; b: number | null; main: boolean }>();
    for (const r of all?.length ? all : main ? [main] : []) {
      const line = Number.parseFloat(String(r.line));
      const a = decimalFromBook(r.over);
      const b = decimalFromBook(r.under);
      if (Number.isFinite(line) && coherentPair(a, b)) out.set(line, { a, b, main: line === mainLine });
    }
    return out;
  };
  for (const b of odds.bookmakers) {
    const home = decimalFromBook(b.H2H?.home);
    const away = decimalFromBook(b.H2H?.away);
    if (coherentPair(home, away)) {
      if (home) h2hHome.push({ book: b.name, price: home, otherPrice: away, line: null });
      if (away) h2hAway.push({ book: b.name, price: away, otherPrice: home, line: null });
    }
    for (const [homeLine, p] of pairs(b.Spread, b.SpreadLines)) spreads.push({ book: b.name, homeLine, home: p.a, away: p.b, main: p.main });
    for (const [line, p] of pairs(b.Total, b.TotalLines)) totals.push({ book: b.name, line, over: p.a, under: p.b, main: p.main });
  }
  return { h2hHome, h2hAway, spreads, totals };
}

export function buildNblGameCandidates(input: {
  odds: NblGameOdds;
  finals: NblFinal[];
  params: AiSportParams;
  currentSeason: number;
  context?: NblGameContext;
}): AiCandidate[] {
  const { odds, params } = input;
  const game: NblGameRef = { homeTeam: odds.homeTeam, awayTeam: odds.awayTeam, commenceTime: odds.commenceTime };
  const eventKey = nblPlayerPropGameKey(game.homeTeam, game.awayTeam, game.commenceTime);
  const baseProj = projectNblGame(game.homeTeam, game.awayTeam, input.finals, input.currentSeason);
  const proj = input.context ? adjustNblGame(baseProj, input.context) : { ...baseProj, notes: [] as string[] };
  const fullProj = input.context ? adjustNblGame(baseProj, { ...input.context, strength: 1 }) : null;
  const sample = Math.min(proj.home?.games ?? 0, proj.away?.games ?? 0);
  const q = gameQuotes(odds);
  const out: AiCandidate[] = [];

  const push = (args: {
    market: 'h2h' | 'spread' | 'total';
    side: AiPickSide;
    line: number | null;
    team: string | null;
    quotes: CandidateQuote[];
    price: (p: NblGameProjection) => SideProbs;
    fair: SideProbs | null;
    marketKind: AiPickMarketKind;
    projection: number;
  }) => {
    const picked = bettableQuote(args.quotes);
    if (!picked || !args.fair) return;
    const model = args.price(proj);
    const w = effectiveModelWeight(params.modelWeight[args.market as string] ?? 0.25, sample, params.sampleHalfLife);
    const mixed = blend(model, args.fair, w);
    const prob = sideWin(mixed, args.side);
    const flags = [...picked.flags];
    const gap = Math.abs(sideWin(model, args.side) - sideWin(args.fair, args.side));
    if (gap > params.maxModelMarketGap) flags.push(`Model and market differ by ${Math.round(gap * 100)}%`);
    if (sample < 3) flags.push('Few games of team form');
    const ev = evPerUnit(prob, picked.best.price, mixed.push);
    const edge = edgeFlag(ev, params.maxTrustedEv);
    if (edge) flags.push(edge);
    const blocked = flags.some((f) => BLOCKING_FLAG.test(f));
    out.push(
      withKey({
        key: '',
        sport: 'nbl',
        eventKey,
        eventLabel: nblEventLabel(game),
        startsAt: game.commenceTime,
        market: args.market,
        marketKind: args.marketKind,
        player: null,
        playerId: null,
        team: args.team,
        side: args.side,
        line: args.line,
        bestPrice: picked.best.price,
        bestBook: picked.best.book,
        quotes: picked.quotes,
        modelProb: round(sideWin(model, args.side)),
        marketProb: round(sideWin(args.fair, args.side)),
        contextProbs: fullProj
          ? { base: round(sideWin(args.price(baseProj), args.side)), full: round(sideWin(args.price(fullProj), args.side)) }
          : null,
        prob: round(prob),
        pushProb: round(mixed.push),
        ev: round(ev),
        projection: args.projection,
        support: [],
        supportScore: null,
        ...eligibility(picked.best.price, args.marketKind, blocked, params),
        flags,
        context: {
          game: proj,
          baseGame: { homeMargin: baseProj.homeMargin, total: baseProj.total },
          modelWeight: round(w),
          teams: input.context ? { home: input.context.home, away: input.context.away } : null,
          homeOut: input.context?.homeOut ?? [],
          awayOut: input.context?.awayOut ?? [],
        },
      })
    );
  };

  const fairH2h = median(
    q.h2hHome.map((x) => (x.otherPrice ? fairTwoWay(x.price, x.otherPrice)?.[0] : null)).filter((p): p is number => p != null)
  );
  if (fairH2h != null) {
    const asProbs = (p: number): SideProbs => ({ over: p, under: 1 - p, push: 0 });
    const price = (p: NblGameProjection) => asProbs(nblH2hProb(p, 'home'));
    push({ market: 'h2h', side: 'home', line: null, team: game.homeTeam, quotes: q.h2hHome.map(({ book, price }) => ({ book, price })), price, fair: asProbs(fairH2h), marketKind: 'main', projection: proj.homeMargin });
    push({ market: 'h2h', side: 'away', line: null, team: game.awayTeam, quotes: q.h2hAway.map(({ book, price }) => ({ book, price })), price, fair: asProbs(fairH2h), marketKind: 'main', projection: -proj.homeMargin });
  }

  const mainSpread = consensusLine(q.spreads.filter((s) => s.main).map((s) => s.homeLine));
  for (const homeLine of new Set(q.spreads.map((s) => s.homeLine))) {
    const at = q.spreads.filter((s) => s.homeLine === homeLine);
    const fair = median(at.map((s) => (s.home && s.away ? fairTwoWay(s.home, s.away)?.[0] : null)).filter((p): p is number => p != null));
    if (fair == null) continue;
    const market: SideProbs = { over: fair, under: 1 - fair, push: 0 };
    const kind: AiPickMarketKind = homeLine === mainSpread ? 'main' : 'alternate';
    const price = (p: NblGameProjection) => nblSpreadProbs(p, 'home', homeLine);
    push({ market: 'spread', side: 'home', line: homeLine, team: game.homeTeam, quotes: at.filter((s) => s.home).map((s) => ({ book: s.book, price: s.home! })), price, fair: market, marketKind: kind, projection: proj.homeMargin });
    push({ market: 'spread', side: 'away', line: -homeLine, team: game.awayTeam, quotes: at.filter((s) => s.away).map((s) => ({ book: s.book, price: s.away! })), price, fair: market, marketKind: kind, projection: -proj.homeMargin });
  }

  const mainTotal = consensusLine(q.totals.filter((t) => t.main).map((t) => t.line));
  for (const line of new Set(q.totals.map((t) => t.line))) {
    const at = q.totals.filter((t) => t.line === line);
    const fair = median(at.map((t) => (t.over && t.under ? fairTwoWay(t.over, t.under)?.[0] : null)).filter((p): p is number => p != null));
    if (fair == null) continue;
    const market: SideProbs = { over: fair, under: 1 - fair, push: 0 };
    const kind: AiPickMarketKind = line === mainTotal ? 'main' : 'alternate';
    const price = (p: NblGameProjection) => nblTotalProbs(p, line);
    push({ market: 'total', side: 'over', line, team: null, quotes: at.filter((t) => t.over).map((t) => ({ book: t.book, price: t.over! })), price, fair: market, marketKind: kind, projection: proj.total });
    push({ market: 'total', side: 'under', line, team: null, quotes: at.filter((t) => t.under).map((t) => ({ book: t.book, price: t.under! })), price, fair: market, marketKind: kind, projection: proj.total });
  }
  return out;
}

export type { NblGameProjection };
