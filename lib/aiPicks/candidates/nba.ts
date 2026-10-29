/**
 * NBA candidates: every player prop line (main, alternate, milestone) and game line (head to head,
 * every spread and total) and double-double / triple-double any book prices, run through the NBA
 * models and the de-vigged market.
 * Same market handling as NBL; the projections and context are NBA's own.
 */

import type { AiPickMarketKind, AiPickSide } from '@/lib/aiPicks/types';
import { isNblPropMarket, NBA_ACHIEVEMENT_MARKETS, type NbaAchievementMarket, type NblPropMarket } from '@/lib/aiPicks/markets';
import { clamp, evPerUnit, fairOneWay, fairTwoWay, round, winShare, type SideProbs } from '@/lib/aiPicks/model/math';
import { supportScore, nblPropSideProbs, type NblPropProjection } from '@/lib/aiPicks/model/nblProps';
import type { NblInjuryContext, NblPropContext } from '@/lib/aiPicks/model/nblContext';
import {
  nbaMinutesSd,
  nbaPlayerEvidence,
  nbaPropSupport,
  nbaTenPlusEvidence,
  nbaTenPlusProb,
  nbaTenPlusSupport,
  projectNbaProp,
} from '@/lib/aiPicks/model/nbaProps';
import {
  adjustNbaGame,
  nbaH2hProb,
  nbaSpreadProbs,
  nbaTotalProbs,
  type NbaGameContext,
  type NbaGameProjection,
} from '@/lib/aiPicks/model/nbaGames';
import { effectiveModelWeight, type AiSportParams } from '@/lib/aiPicks/params';
import {
  BLOCKING_FLAG,
  betKind,
  bettableQuote,
  edgeFlag,
  eligibility,
  type AiCandidate,
  type CandidateQuote,
} from '@/lib/aiPicks/candidates/types';
import { isSharpBook, sharpFair, sharpSplit } from '@/lib/aiPicks/candidates/sharp';
import {
  blend,
  bookOversAt,
  cleanLadder,
  gameQuotes,
  isNormalLine,
  mainLineFlags,
  marketMean,
  marketProbsAt,
  propSelections,
  sideWin,
  withKey,
} from '@/lib/aiPicks/candidates/nbl';
import { consensusLine } from '@/lib/nbl/lineMovement';
import type { NblSnapLine } from '@/lib/nbl/playerPropSnapshots';
import type { NblGameOdds } from '@/lib/nbl/oddsTypes';
import { NBA_STAT_TO_PROP_KEY, normalizeNbaPropPlayerName } from '@/lib/nba/dash/odds';
import type { NbaBookRow, NbaGameOdds } from '@/lib/nba/dash/oddsTypes';
import type { NbaGameLogRow } from '@/lib/nba/dash/types';
import { decimalFromBook } from '@/lib/tennisAi/availability';

export type NbaGameRef = { gameId: string; homeTeam: string; awayTeam: string; commenceTime: string };

export type NbaResolvedPlayer = { playerId: string; name: string; team: string; teamCode: string; games: NbaGameLogRow[] };

export function nbaEventLabel(g: Pick<NbaGameRef, 'homeTeam' | 'awayTeam'>): string {
  return `${g.awayTeam} @ ${g.homeTeam}`;
}

/**
 * A book whose main spread puts the line on the wrong side of its own head-to-head favourite has its
 * spreads mislabeled; its head to head and totals are kept.
 */
export function saneSpreads(row: NbaBookRow): NbaBookRow {
  const home = Number.parseFloat(row.H2H?.home);
  const away = Number.parseFloat(row.H2H?.away);
  const line = Number.parseFloat(row.Spread?.line);
  if (!Number.isFinite(home) || !Number.isFinite(away) || !Number.isFinite(line) || Math.abs(line) < 2) return row;
  const decimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));
  const homeFav = decimal(home) < decimal(away);
  if (homeFav === line < 0) return row;
  const { SpreadLines: _drop, ...rest } = row;
  return { ...rest, Spread: { line: 'N/A', over: 'N/A', under: 'N/A' } };
}

export type NbaRosterEntry = { id: string; norm: string; compact: string; first: string; last: string; tokens: string[] };

/** Name words: lowercased letters only, so "A.J.", "AJ" and ',,Aj"' agree and hyphenated names split. */
function nameTokens(name: string): string[] {
  return normalizeNbaPropPlayerName(name)
    .replace(/-/g, ' ')
    .split(' ')
    .map((t) => t.replace(/[^a-z]/g, ''))
    .filter(Boolean);
}

export function nbaRosterEntry(id: string, name: string): NbaRosterEntry {
  const tokens = nameTokens(name);
  return { id, norm: normalizeNbaPropPlayerName(name), compact: tokens.join(''), first: tokens[0] ?? '', last: tokens.at(-1) ?? '', tokens };
}

/** Edit distance, for surnames a book misspelled ("Cuningham"). */
function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length]!;
}

const closeSurname = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= (b.length >= 8 ? 2 : 1));

/**
 * Board name to player id among the two teams' players. Books write names their own way: surname
 * first ("Duren Jalen"), initials ("D White", "Aj Green"), middle names ("Cormac Karl Max Christie"),
 * nicknames ("Ron Holland", "Ace Bailey"), double-barrelled ("Rudy Gobert-Bourgarel") and plain typos
 * ("C Cuningham"). Strictest test first; a test only counts when exactly one player passes it.
 */
export function resolveNbaBoardName(name: string, roster: NbaRosterEntry[]): string | null {
  const tokens = nameTokens(name);
  if (!tokens.length) return null;
  const compact = tokens.join('');
  const reversed = [...tokens].reverse().join('');
  const unique = (hits: NbaRosterEntry[]) => (new Set(hits.map((h) => h.id)).size === 1 ? hits[0]!.id : null);
  const exact = unique(roster.filter((r) => r.compact === compact));
  if (exact || tokens.length < 2) return exact;
  // Some other word on the board is his first name (or its initial / short form).
  const firstFits = (r: NbaRosterEntry, surnameAt: number, loose: boolean) =>
    tokens.some((t, i) => i !== surnameAt && (t === r.first || (loose && (r.first.startsWith(t) || t.startsWith(r.first) || t[0] === r.first[0]))));
  const surnameAt = (r: NbaRosterEntry, close: boolean) => tokens.findIndex((t) => (close ? closeSurname(t, r.last) : t === r.last));
  const tries: Array<(r: NbaRosterEntry) => boolean> = [
    (r) => r.compact === reversed,
    (r) => r.tokens.length > 0 && r.tokens.every((t) => tokens.includes(t)),
    (r) => surnameAt(r, false) >= 0 && firstFits(r, surnameAt(r, false), false),
    (r) => surnameAt(r, false) >= 0 && firstFits(r, surnameAt(r, false), true),
    (r) => surnameAt(r, true) >= 0 && firstFits(r, surnameAt(r, true), true),
  ];
  for (const t of tries) {
    const hit = unique(roster.filter(t));
    if (hit) return hit;
  }
  return null;
}

/**
 * Board lines for one player, in the NBL snapshot shape the shared market helpers read. `names` are
 * the board spellings of one player; a book's line under a second spelling only adds what the first lacks.
 */
export function nbaPlayerLines(odds: NbaGameOdds, names: string | string[]): NblSnapLine[] {
  const list = typeof names === 'string' ? [names] : names;
  const player = list[0] ?? '';
  const out: NblSnapLine[] = [];
  const seen = new Set<string>();
  for (const [book, players] of Object.entries(odds.playerProps ?? {})) {
    for (const name of list) {
      const props = players?.[name];
      if (!props) continue;
      for (const [stat, key] of Object.entries(NBA_STAT_TO_PROP_KEY)) {
        if (!isNblPropMarket(stat)) continue;
        for (const e of props[key] ?? []) {
          const value = Number(e.line);
          if (!Number.isFinite(value)) continue;
          const milestone = Boolean(e.milestone);
          const id = `${book}|${stat}|${milestone}|${value}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({
            player,
            playerKey: player.toLowerCase(),
            book,
            stat,
            kind: milestone ? 'milestone' : 'ou',
            // "25+" is over 24.5, the NBL convention the grader and the titles use.
            line: milestone ? value - 0.5 : value,
            label: milestone ? `${value}+` : String(value),
            over: e.over,
            under: milestone ? 'N/A' : e.under,
            overDecimal: decimalFromBook(e.over),
            underDecimal: milestone ? null : decimalFromBook(e.under),
          });
        }
      }
    }
  }
  return out;
}

/** The sharp books' and everyone else's fair price for the side we back (kept to judge the sharp weighting later). */
function sideSplit(split: ReturnType<typeof sharpSplit> | null, side: AiPickSide): { sharpProb?: number; restProb?: number } {
  if (!split) return {};
  const pick = (p: number | null) => (p == null ? undefined : round(side === 'under' || side === 'away' ? 1 - p : p, 4));
  return { sharpProb: pick(split.sharp), restProb: pick(split.rest) };
}

export type NbaPropGameContext = {
  forStat: (stat: NblPropMarket, proj: NblPropProjection) => NblPropContext;
  listed: NblInjuryContext | null;
  /** Questionable big-minutes teammates ("Name (status)"); his unders wait for their call. */
  waitingOn: string[];
  /** Non-blocking notes (early season, ...) and blocking ones (not playing lately). */
  flags: string[];
  facts: Record<string, unknown>;
};

/** Projection this far from the market's number (share of it) keeps the model's full say... */
export const NBA_TRUST_FULL_GAP = 0.15;
/** ...and this far or more leaves the price to the market alone. */
export const NBA_TRUST_NONE_GAP = 0.4;

/**
 * Share of the model's weight kept for a prop. A projection far from the market usually missed a role
 * change (early season leans on last season), and those bets lost; the market's number wins out.
 */
export function nbaModelTrust(projection: number, marketMean: number): number {
  if (!(marketMean > 0)) return 1;
  const gap = Math.abs(projection - marketMean) / marketMean;
  return clamp(1 - (gap - NBA_TRUST_FULL_GAP) / (NBA_TRUST_NONE_GAP - NBA_TRUST_FULL_GAP), 0, 1);
}

export function buildNbaPropCandidates(input: {
  game: NbaGameRef;
  lines: NblSnapLine[];
  player: NbaResolvedPlayer;
  opponent: { name: string; code: string | null };
  params: AiSportParams;
  currentSeason: number;
  context: NbaPropGameContext;
}): AiCandidate[] {
  const { game, player, params, context } = input;
  const out: AiCandidate[] = [];
  const byStat = new Map<NblPropMarket, NblSnapLine[]>();
  for (const l of input.lines) {
    if (!isNblPropMarket(l.stat)) continue;
    byStat.set(l.stat, [...(byStat.get(l.stat) ?? []), l]);
  }

  for (const [stat, rawLines] of byStat) {
    const lines = cleanLadder(rawLines);
    const base = projectNbaProp(player.games, stat, input.currentSeason);
    if (!base) continue;
    const ctx = context.forStat(stat, base);
    const scaled = (t: number): NblPropProjection => ({ ...base, mean: round(base.mean * t, 2), variance: round(base.variance * t, 2) });
    const proj = scaled(ctx.total);
    const fullProj = scaled(ctx.fullTotal);
    const mkt = marketMean(lines, proj, params.oneWayMarginPower, sharpFair);
    if (!mkt) continue;
    const baseFlags: string[] = [...context.flags];
    const listed = context.listed;
    if (listed) baseFlags.push(/out/i.test(listed.status) ? `Listed out on the injury report (${listed.status})` : `On the injury report (${listed.status})`);
    if (mkt.source === 'milestone') baseFlags.push('No over/under posted yet');
    const trust = nbaModelTrust(proj.mean, mkt.mean);
    if (trust < 1) {
      const off = Math.round((Math.abs(proj.mean - mkt.mean) / mkt.mean) * 100);
      baseFlags.push(`Projection ${off}% off the market's ${round(mkt.mean, 1)}: leaning on the market`);
    }

    for (const sel of propSelections(lines)) {
      const picked = bettableQuote(sel.quotes);
      if (!picked) continue;
      const model = nblPropSideProbs(proj, sel.line);
      const market = marketProbsAt(sel, lines, mkt, proj, params.oneWayMarginPower, sharpFair);
      if (!market) continue;
      const split = sel.kind === 'ou' ? sharpSplit(bookOversAt(lines, sel.line)) : null;
      const kindKey = sel.kind === 'milestone' ? 'milestone' : 'prop';
      const w = trust * effectiveModelWeight(params.modelWeight[kindKey] ?? 0.35, proj.sample, params.sampleHalfLife);
      const mixed = blend(model, market, w);
      const prob = sideWin(mixed, sel.side);
      const ev = evPerUnit(prob, picked.best.price, mixed.push);
      const lineKind: AiPickMarketKind =
        sel.kind === 'milestone' ? 'milestone' : isNormalLine(lines, mkt.mainLine, sel.line) ? 'main' : 'alternate';
      const support = nbaPropSupport(player.games, stat, sel.line, sel.side, {
        currentSeason: input.currentSeason,
        opponentCode: input.opponent.code,
        opponentName: input.opponent.name,
      });
      const score = supportScore(support);
      const flags = [...baseFlags, ...picked.flags, ...mainLineFlags(sel, mkt.mainLine, lines)];
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
          sport: 'nba',
          eventKey: game.gameId,
          eventLabel: nbaEventLabel(game),
          startsAt: game.commenceTime,
          market: stat,
          marketKind: betKind(lineKind, picked.best),
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
          contextProbs: {
            base: round(sideWin(nblPropSideProbs(base, sel.line), sel.side)),
            full: round(sideWin(nblPropSideProbs(fullProj, sel.line), sel.side)),
          },
          prob: round(prob),
          pushProb: round(mixed.push),
          ev: round(ev),
          projection: proj.mean,
          support,
          supportScore: score,
          ...eligibility(picked.best.price, lineKind, blocked, params),
          flags,
          context: {
            projection: proj,
            baseProjection: base.mean,
            adjustment: ctx.total,
            factors: ctx.factors,
            marketMean: round(mkt.mean, 2),
            marketSource: mkt.source,
            mainLine: mkt.mainLine,
            lineKind,
            modelWeight: round(w),
            listedStatus: listed?.status ?? null,
            waitingOn: context.waitingOn,
            ...sideSplit(split, sel.side),
            opponent: input.opponent.name,
            evidence: nbaPlayerEvidence(player.games, stat, input.currentSeason),
            facts: context.facts,
          },
        })
      );
    }
  }
  return out;
}

/** Board key per achievement market. */
const ACHIEVEMENT_KEY: Record<NbaAchievementMarket, { key: string; need: number }> = {
  doubleDouble: { key: 'DD', need: 2 },
  tripleDouble: { key: 'TD', need: 3 },
};

export type NbaAchievementQuote = { book: string; yes: number; no: number | null };

/** "Yes" prices (and "No" where a book offers it) for one player's double-double / triple-double. */
export function nbaAchievementQuotes(odds: NbaGameOdds, names: string | string[], market: NbaAchievementMarket): NbaAchievementQuote[] {
  const list = typeof names === 'string' ? [names] : names;
  const out: NbaAchievementQuote[] = [];
  for (const [book, players] of Object.entries(odds.playerProps ?? {})) {
    for (const name of list) {
      const e = players?.[name]?.[ACHIEVEMENT_KEY[market].key]?.[0];
      const yes = e ? decimalFromBook(e.over) : null;
      if (!yes) continue;
      out.push({ book, yes, no: e!.milestone ? null : decimalFromBook(e!.under) });
      break;
    }
  }
  return out;
}

/**
 * The market's chance of yes. Two-way books de-vig normally; yes-only books lose a one-way margin.
 * Books on a shared feed post the same price, which only counts once.
 */
export function nbaAchievementFair(quotes: NbaAchievementQuote[], oneWayMarginPower: number) {
  const seen = new Set<string>();
  const fairs: Array<{ book: string; p: number }> = [];
  for (const q of quotes) {
    const id = `${q.yes}|${q.no ?? ''}`;
    if (seen.has(id) && !isSharpBook(q.book)) continue;
    seen.add(id);
    const p = q.no ? fairTwoWay(q.yes, q.no)?.[0] ?? null : fairOneWay(q.yes, oneWayMarginPower);
    if (p != null) fairs.push({ book: q.book, p });
  }
  return sharpSplit(fairs);
}

export function buildNbaAchievementCandidates(input: {
  game: NbaGameRef;
  odds: NbaGameOdds;
  names: string[];
  player: NbaResolvedPlayer;
  opponent: { name: string; code: string | null };
  params: AiSportParams;
  currentSeason: number;
  context: NbaPropGameContext;
}): AiCandidate[] {
  const { game, player, params, context } = input;
  const stats = ['points', 'rebounds', 'assists'] as const;
  const bases = stats.map((s) => projectNbaProp(player.games, s, input.currentSeason));
  if (bases.some((b) => !b)) return [];
  const scaled = (p: NblPropProjection, t: number): NblPropProjection => ({ ...p, mean: round(p.mean * t, 2), variance: round(p.variance * t, 2) });
  const ctxs = stats.map((s, i) => context.forStat(s, bases[i]!));
  const proj = bases.map((b, i) => scaled(b!, ctxs[i]!.total));
  const full = bases.map((b, i) => scaled(b!, ctxs[i]!.fullTotal));
  const minutesSd = nbaMinutesSd(player.games, input.currentSeason);
  const listed = context.listed;
  const out: AiCandidate[] = [];

  for (const market of NBA_ACHIEVEMENT_MARKETS) {
    const quotes = nbaAchievementQuotes(input.odds, input.names, market);
    const picked = bettableQuote(quotes.map((q) => ({ book: q.book, price: q.yes })));
    const split = nbaAchievementFair(quotes, params.oneWayMarginPower);
    if (!picked || split.fair == null) continue;
    const need = ACHIEVEMENT_KEY[market].need;
    const yes = (parts: NblPropProjection[]): SideProbs => {
      const p = nbaTenPlusProb(parts, minutesSd, need);
      return { over: p, under: 1 - p, push: 0 };
    };
    const model = yes(proj);
    const marketProbs: SideProbs = { over: split.fair, under: 1 - split.fair, push: 0 };
    const w = effectiveModelWeight(params.modelWeight[market] ?? 0.3, proj[0]!.sample, params.sampleHalfLife);
    const mixed = blend(model, marketProbs, w);
    const ev = evPerUnit(mixed.over, picked.best.price, 0);
    const support = nbaTenPlusSupport(player.games, need, {
      currentSeason: input.currentSeason,
      opponentCode: input.opponent.code,
      opponentName: input.opponent.name,
    });
    const score = supportScore(support);
    const flags = [...context.flags, ...picked.flags];
    if (listed) flags.push(/out/i.test(listed.status) ? `Listed out on the injury report (${listed.status})` : `On the injury report (${listed.status})`);
    const gap = Math.abs(model.over - split.fair);
    if (gap > params.maxModelMarketGap) flags.push(`Model and market differ by ${Math.round(gap * 100)}%`);
    if (score != null && score < params.minSupport) flags.push('Thin support in the game logs');
    if (picked.best.price > params.maxPriceSingle) flags.push('Long shot');
    const edge = edgeFlag(ev, params.maxTrustedEv);
    if (edge) flags.push(edge);
    const blocked = flags.some((f) => BLOCKING_FLAG.test(f));
    out.push(
      withKey({
        key: '',
        sport: 'nba',
        eventKey: game.gameId,
        eventLabel: nbaEventLabel(game),
        startsAt: game.commenceTime,
        market,
        marketKind: 'main',
        player: player.name,
        playerId: player.playerId,
        team: player.team,
        side: 'over',
        line: 0.5,
        bestPrice: picked.best.price,
        bestBook: picked.best.book,
        quotes: picked.quotes,
        modelProb: round(model.over),
        marketProb: round(split.fair),
        contextProbs: { base: round(yes(bases as NblPropProjection[]).over), full: round(yes(full).over) },
        prob: round(mixed.over),
        pushProb: 0,
        ev: round(ev),
        projection: null,
        support,
        supportScore: score,
        ...eligibility(picked.best.price, 'main', blocked, params),
        flags,
        context: {
          projections: Object.fromEntries(stats.map((s, i) => [s, proj[i]!.mean])),
          baseProjections: Object.fromEntries(stats.map((s, i) => [s, bases[i]!.mean])),
          expectedMinutes: proj[0]!.expectedMinutes,
          minutesSd: round(minutesSd, 1),
          factors: Object.fromEntries(stats.map((s, i) => [s, ctxs[i]!.factors])),
          marketSource: 'main',
          modelWeight: round(w),
          listedStatus: listed?.status ?? null,
          waitingOn: context.waitingOn,
          ...sideSplit(split, 'over'),
          opponent: input.opponent.name,
          evidence: nbaTenPlusEvidence(player.games, input.currentSeason),
          facts: context.facts,
        },
      })
    );
  }
  return out;
}

export function buildNbaGameCandidates(input: {
  odds: NbaGameOdds;
  base: NbaGameProjection;
  params: AiSportParams;
  context: NbaGameContext;
  /** Fewest games either team has behind its ratings (current season counts fully). */
  sample: number;
  flags?: string[];
  /** Questionable big-minutes regulars per team ("Name (status)"). */
  waitingOn?: { home: string[]; away: string[] };
}): AiCandidate[] {
  const { odds, params } = input;
  const game: NbaGameRef = { gameId: odds.gameId, homeTeam: odds.homeTeam, awayTeam: odds.awayTeam, commenceTime: odds.commenceTime };
  const baseProj = input.base;
  const proj = adjustNbaGame(baseProj, input.context);
  const fullProj = adjustNbaGame(baseProj, { ...input.context, strength: 1 });
  const q = gameQuotes(odds as unknown as NblGameOdds);
  const out: AiCandidate[] = [];

  const push = (args: {
    market: 'h2h' | 'spread' | 'total';
    side: AiPickSide;
    line: number | null;
    team: string | null;
    quotes: CandidateQuote[];
    price: (p: NbaGameProjection) => SideProbs;
    fair: SideProbs | null;
    split: ReturnType<typeof sharpSplit>;
    marketKind: AiPickMarketKind;
    projection: number;
  }) => {
    const picked = bettableQuote(args.quotes);
    if (!picked || !args.fair) return;
    const model = args.price(proj);
    const w = effectiveModelWeight(params.modelWeight[args.market] ?? 0.15, input.sample, params.sampleHalfLife);
    const mixed = blend(model, args.fair, w);
    const prob = sideWin(mixed, args.side);
    const flags = [...(input.flags ?? []), ...picked.flags];
    if (args.marketKind === 'alternate') flags.push('Alternate line: main lines only');
    const gap = Math.abs(sideWin(model, args.side) - sideWin(args.fair, args.side));
    if (gap > params.maxModelMarketGap) flags.push(`Model and market differ by ${Math.round(gap * 100)}%`);
    const ev = evPerUnit(prob, picked.best.price, mixed.push);
    const edge = edgeFlag(ev, params.maxTrustedEv);
    if (edge) flags.push(edge);
    const blocked = flags.some((f) => BLOCKING_FLAG.test(f));
    out.push(
      withKey({
        key: '',
        sport: 'nba',
        eventKey: game.gameId,
        eventLabel: nbaEventLabel(game),
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
        contextProbs: { base: round(sideWin(args.price(baseProj), args.side)), full: round(sideWin(args.price(fullProj), args.side)) },
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
          teams: { home: baseProj.home, away: baseProj.away },
          homeOut: input.context.homeMissing.players,
          awayOut: input.context.awayMissing.players,
          homeRestDays: input.context.homeRestDays,
          awayRestDays: input.context.awayRestDays,
          waitingOn: [...(input.waitingOn?.home ?? []), ...(input.waitingOn?.away ?? [])],
          waitingOnHome: input.waitingOn?.home ?? [],
          waitingOnAway: input.waitingOn?.away ?? [],
          ...sideSplit(args.split, args.side),
        },
      })
    );
  };

  const asProbs = (p: number): SideProbs => ({ over: p, under: 1 - p, push: 0 });
  const fairs = (rows: Array<{ book: string; a: number | null; b: number | null }>) =>
    sharpSplit(rows.map((r) => ({ book: r.book, p: (r.a && r.b ? fairTwoWay(r.a, r.b)?.[0] : null) as number })).filter((f) => f.p != null));

  const h2h = fairs(q.h2hHome.map((x) => ({ book: x.book, a: x.price, b: x.otherPrice ?? null })));
  if (h2h.fair != null) {
    const price = (p: NbaGameProjection) => asProbs(nbaH2hProb(p, 'home'));
    const fair = asProbs(h2h.fair);
    push({ market: 'h2h', side: 'home', line: null, team: game.homeTeam, quotes: q.h2hHome.map(({ book, price }) => ({ book, price })), price, fair, split: h2h, marketKind: 'main', projection: proj.homeMargin });
    push({ market: 'h2h', side: 'away', line: null, team: game.awayTeam, quotes: q.h2hAway.map(({ book, price }) => ({ book, price })), price, fair, split: h2h, marketKind: 'main', projection: -proj.homeMargin });
  }

  const mainSpread = consensusLine(q.spreads.filter((s) => s.main).map((s) => s.homeLine));
  for (const homeLine of new Set(q.spreads.map((s) => s.homeLine))) {
    const at = q.spreads.filter((s) => s.homeLine === homeLine);
    const split = fairs(at.map((s) => ({ book: s.book, a: s.home, b: s.away })));
    if (split.fair == null) continue;
    const fair = asProbs(split.fair);
    const kind: AiPickMarketKind = homeLine === mainSpread ? 'main' : 'alternate';
    const price = (p: NbaGameProjection) => nbaSpreadProbs(p, 'home', homeLine);
    push({ market: 'spread', side: 'home', line: homeLine, team: game.homeTeam, quotes: at.filter((s) => s.home).map((s) => ({ book: s.book, price: s.home! })), price, fair, split, marketKind: kind, projection: proj.homeMargin });
    push({ market: 'spread', side: 'away', line: -homeLine, team: game.awayTeam, quotes: at.filter((s) => s.away).map((s) => ({ book: s.book, price: s.away! })), price, fair, split, marketKind: kind, projection: -proj.homeMargin });
  }

  const mainTotal = consensusLine(q.totals.filter((t) => t.main).map((t) => t.line));
  for (const line of new Set(q.totals.map((t) => t.line))) {
    const at = q.totals.filter((t) => t.line === line);
    const split = fairs(at.map((t) => ({ book: t.book, a: t.over, b: t.under })));
    if (split.fair == null) continue;
    const fair = asProbs(split.fair);
    const kind: AiPickMarketKind = line === mainTotal ? 'main' : 'alternate';
    const price = (p: NbaGameProjection) => nbaTotalProbs(p, line);
    push({ market: 'total', side: 'over', line, team: null, quotes: at.filter((t) => t.over).map((t) => ({ book: t.book, price: t.over! })), price, fair, split, marketKind: kind, projection: proj.total });
    push({ market: 'total', side: 'under', line, team: null, quotes: at.filter((t) => t.under).map((t) => ({ book: t.book, price: t.under! })), price, fair, split, marketKind: kind, projection: proj.total });
  }
  return out;
}
