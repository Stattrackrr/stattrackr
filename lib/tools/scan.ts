/**
 * Scan normalized market maps for arb, middles, EV and bonus flips.
 */

import { canonBook, displayBook, isSharpBook, isSoftBook, TOOLS_SHARP_SET } from './books';
import type { ToolsSnapshot } from './fetch';
import {
  arbStakes,
  bonusFlip,
  evFraction,
  middleExpected,
  middleStakes,
  middleWindow,
  pctLabel,
  saneEv,
  saneTwoWay,
  sharpFairProbs,
} from './math';
import { buildMarketMap, outcomeLabel, type MarketMap, type OutcomeBooks, type ParsedMarketMeta } from './markets';
import { toolsMatchImages, toolsPlayerImage } from './media';
import type { ToolsBonusFlip, ToolsOpportunity, ToolsSport } from './types';

function subjectFields(
  sport: string,
  info: ParsedMarketMeta | undefined
): { subjectName?: string | null; subjectImageUrl?: string | null } {
  // Player props + tennis player totals (games/sets won) show the subject headshot.
  if (info?.family !== 'player_prop' && info?.family !== 'team_total') return {};
  const subjectName = info.playerName || null;
  if (!subjectName) return {};
  return {
    subjectName,
    subjectImageUrl: toolsPlayerImage(sport, subjectName),
  };
}

const MIN_ARB_ROI = 0.005; // 0.5%
const MIN_EV = 0.02; // 2%
const MIN_BONUS_RETENTION = 0.55; // keep ≥55% of bonus as cash
const MAX_PRICE_AGE_MS = 45 * 60_000;
/** Totals/handicap middle must be at least this wide (points). */
const MIN_MIDDLE_WIDTH = 1;
/** On a $100 two-leg stake, worst one-sided loss cannot exceed this ($ = %). */
const MAX_MIDDLE_RISK = 25;
/** Soft prices outside this band are dog/fav alt junk, not a playable middle. */
const MIDDLE_ODDS_MIN = 1.4;
const MIDDLE_ODDS_MAX = 3.2;
/** Caps raised — Redis board now feeds player props as well as game lines. */
const MAX_MIDDLES_PER_MATCH = 8;
const MAX_ARB_PER_MATCH = 40;
const MAX_EV_PER_MATCH = 60;

/** Home-oriented handicap line → that outcome's signed line (away flips the sign). */
function lineForOutcome(info: ParsedMarketMeta | undefined, outcome: string): string | null {
  if (!info || info.line == null || info.family === 'moneyline') return null;
  if (info.family === 'handicap') {
    const signed = outcome === 'away' ? -info.line : info.line;
    return signed > 0 ? `+${signed}` : String(signed);
  }
  return String(info.line);
}

function winASetWho(info: ParsedMarketMeta | undefined, home: string, away: string): string {
  if (info?.playerName) return info.playerName;
  if (info?.side === 'home') return home || 'Home';
  if (info?.side === 'away') return away || 'Away';
  return 'Player';
}

/** Card / leg label for win-a-set Over vs Under (never bare Yes/No). */
function winASetLabel(
  outcome: string,
  home: string,
  away: string,
  info: ParsedMarketMeta | undefined
): string {
  const who = winASetWho(info, home, away);
  return outcome.toLowerCase() === 'under' ? `${who} to not win a set` : `${who} to win a set`;
}

function selectionWithLine(
  outcome: string,
  home: string,
  away: string,
  info: ParsedMarketMeta | undefined
): string {
  const o = outcome.toLowerCase();
  if (info?.winASet) return winASetLabel(o, home, away, info);
  const name = outcomeLabel(outcome, home, away);
  const line = lineForOutcome(info, outcome);
  if (info?.family === 'moneyline') return `${name} to win`;
  if (info?.family === 'handicap' && line) return `${name} ${line}`;
  if (info?.family === 'total') {
    if (!line) return name;
    // Match total middles: "Total games Over 16.5"
    return `${totalMiddleMarket(info.metric)} ${name} ${line}`;
  }
  if (info?.family === 'team_total' || info?.family === 'player_prop') {
    // Card header already has "Player Assists 4.5" — leg is just Over/Under + line.
    return line ? `${name} ${line}` : name;
  }
  return name;
}

function totalMiddleMarket(metric: string | undefined): string {
  const m = String(metric || '').toLowerCase();
  if (m === 'games' || /\bgames?\b/.test(m)) return 'Total games';
  if (m === 'sets' || /\bsets?\b/.test(m)) return 'Total sets';
  return 'Total';
}

function middleWindowUnit(metric: string | undefined): string {
  const m = String(metric || '').toLowerCase();
  if (m === 'games' || /\bgames?\b/.test(m)) return 'games';
  if (m === 'sets' || /\bsets?\b/.test(m)) return 'sets';
  return 'pts';
}

/** e.g. Total games Over 16.5 — full market so the bet is unambiguous. */
function totalSideSelection(side: 'Over' | 'Under', line: number, metric: string | undefined): string {
  return `${totalMiddleMarket(metric)} ${side} ${line}`;
}

function bestSoft(books: Map<string, number>, exclude?: string): { book: string; odds: number } | null {
  let best: { book: string; odds: number } | null = null;
  for (const [book, odds] of books) {
    if (exclude && book === exclude) continue;
    if (!isSoftBook(book)) continue;
    if (!best || odds > best.odds) best = { book, odds };
  }
  return best;
}

/** Stable two-way order so fair[0] always lines up with the same outcome key. */
function orderedOutcomes(byOutcome: OutcomeBooks): [string, string] | null {
  if (byOutcome.has('home') && byOutcome.has('away')) return ['home', 'away'];
  if (byOutcome.has('over') && byOutcome.has('under')) return ['over', 'under'];
  const keys = [...byOutcome.keys()];
  return keys.length === 2 ? [keys[0]!, keys[1]!] : null;
}

function avgSoftOdds(books: Map<string, number> | undefined): number | null {
  if (!books?.size) return null;
  let sum = 0;
  let n = 0;
  for (const [book, odds] of books) {
    if (!isSoftBook(book) || !(odds > 1)) continue;
    sum += odds;
    n += 1;
  }
  return n ? sum / n : null;
}

function middleOddsOk(a: number, b: number): boolean {
  if (!(a >= MIDDLE_ODDS_MIN && a <= MIDDLE_ODDS_MAX)) return false;
  if (!(b >= MIDDLE_ODDS_MIN && b <= MIDDLE_ODDS_MAX)) return false;
  // Middles aren't arbs; still reject absurd vig / stale mismatches.
  return saneTwoWay(a, b, 0.92);
}

type SharpAligned = { book: string; oa: number; ob: number };

/**
 * Align each sharp book's two-way to outcomes [a,b].
 * H2H only: if a sharp book’s favourite disagrees with soft consensus (tennis feeds
 * sometimes swap home/away), flip that pair. Never flip over/under — those labels are absolute.
 */
function sharpAligned(byOutcome: OutcomeBooks, a: string, b: string): SharpAligned[] {
  const softA = avgSoftOdds(byOutcome.get(a));
  const softB = avgSoftOdds(byOutcome.get(b));
  const softFavIsA = softA != null && softB != null ? softA < softB : null;
  const isOu = a === 'over' && b === 'under';
  const out: SharpAligned[] = [];
  for (const sharp of TOOLS_SHARP_SET) {
    let oa = byOutcome.get(a)?.get(sharp);
    let ob = byOutcome.get(b)?.get(sharp);
    if (!(oa && ob)) continue;
    // Junk two-way (e.g. Pinnacle win-a-set Yes 1.43 / No 1.32 → 46% overround).
    if (!saneTwoWay(oa, ob)) continue;
    if (!isOu && softFavIsA != null && oa < ob !== softFavIsA) {
      const tmp = oa;
      oa = ob;
      ob = tmp;
    }
    out.push({ book: sharp, oa, ob });
  }
  return out;
}

function sharpPair(byOutcome: OutcomeBooks, a: string, b: string): Array<[number, number]> {
  return sharpAligned(byOutcome, a, b).map((r) => [r.oa, r.ob]);
}

/** Raw sharp decimal on one side of [a,b], after the same alignment as fair. */
function sharpSideRefs(
  byOutcome: OutcomeBooks,
  a: string,
  b: string,
  side: string
): Array<{ book: string; bookKey: string; odds: number }> {
  const aligned = sharpAligned(byOutcome, a, b);
  const refs: Array<{ book: string; bookKey: string; odds: number }> = [];
  for (const row of aligned) {
    const odds = side === a ? row.oa : side === b ? row.ob : null;
    if (!(odds != null && odds > 1)) continue;
    refs.push({ book: displayBook(row.book), bookKey: row.book, odds });
  }
  return refs;
}

function freshEnough(asOf: Record<string, number>, books: string[], now: number): boolean {
  for (const b of books) {
    const t = asOf[b] ?? asOf[canonBook(b)];
    if (t == null) continue; // missing asOf: allow (some books omit)
    if (now - t > MAX_PRICE_AGE_MS) return false;
  }
  return true;
}

function marketId(sport: string, eventId: string, key: string, kind: string, extra: string): string {
  return `${kind}:${sport}:${eventId}:${key}:${extra}`;
}

function scanEventOpportunities(
  snap: ToolsSnapshot,
  now: number
): { arb: ToolsOpportunity[]; middles: ToolsOpportunity[]; ev: ToolsOpportunity[] } {
  const { event, items, asOf } = snap;
  const { markets, meta } = buildMarketMap(items, {
    sportApi: event.apiSport,
    includePlayerProps: true,
    home: event.home,
    away: event.away,
  });
  const arb: ToolsOpportunity[] = [];
  const middles: ToolsOpportunity[] = [];
  const ev: ToolsOpportunity[] = [];
  const match = `${event.home} vs ${event.away}`;
  const images = toolsMatchImages(event.sport, event.home, event.away);
  // Player/team identity + headshots — must not be shadowed by EV fair-side loops below.
  const matchSides = { home: event.home, away: event.away, ...images };
  const boardSport = event.sport as ToolsSport;

  for (const [key, byOutcome] of markets) {
    const ordered = orderedOutcomes(byOutcome);
    if (!ordered) continue;
    const [oA, oB] = ordered;
    const info = meta.get(key);

    // --- Arbitrage: best soft on each side, same market key ---
    const softA = bestSoft(byOutcome.get(oA)!);
    const softB = bestSoft(byOutcome.get(oB)!);
    if (softA && softB && softA.book !== softB.book) {
      const stakes = arbStakes(softA.odds, softB.odds, 100);
      if (stakes && stakes.roi >= MIN_ARB_ROI && saneTwoWay(softA.odds, softB.odds) && freshEnough(asOf, [softA.book, softB.book], now)) {
        arb.push({
          id: marketId(event.sport, event.eventId, key, 'arb', `${softA.book}-${softB.book}`),
          kind: 'arb',
          sport: boardSport,
          league: event.league,
          match,
          ...matchSides,
          ...subjectFields(boardSport, info),
          market: info?.label ?? key,
          startMs: event.startMs,
          edgeLabel: `${pctLabel(stakes.roi)} locked`,
          edge: stakes.roi,
          note: `Equalised on $100 · ${displayBook(softA.book)} / ${displayBook(softB.book)}`,
          legs: [
            {
              book: displayBook(softA.book),
              bookKey: softA.book,
              selection: selectionWithLine(oA, event.home, event.away, info),
              odds: softA.odds,
              stake: stakes.stakeA,
              line: lineForOutcome(info, oA),
            },
            {
              book: displayBook(softB.book),
              bookKey: softB.book,
              selection: selectionWithLine(oB, event.home, event.away, info),
              odds: softB.odds,
              stake: stakes.stakeB,
              line: lineForOutcome(info, oB),
            },
          ],
        });
      }
    }

    // --- EV: sharp fair on this exact line; one card per side with every soft priced ---
    const pairs = sharpPair(byOutcome, oA, oB);
    const fair = sharpFairProbs(pairs);
    if (fair) {
      const fairSides: Array<{ outcome: string; p: number }> = [
        { outcome: oA, p: fair[0] },
        { outcome: oB, p: fair[1] },
      ];
      for (const side of fairSides) {
        const books = byOutcome.get(side.outcome)!;
        const legs: ToolsOpportunity['legs'] = [];
        for (const [book, odds] of books) {
          if (!isSoftBook(book)) continue;
          if (!freshEnough(asOf, [book], now)) continue;
          const edge = evFraction(odds, side.p);
          if (edge == null || edge < MIN_EV) continue;
          // Drop flipped-side garbage (fair 1.02 × soft 19 → +1700% EV).
          if (!saneEv(odds, side.p, edge)) continue;
          legs.push({
            book: displayBook(book),
            bookKey: book,
            selection: selectionWithLine(side.outcome, event.home, event.away, info),
            odds,
            line: lineForOutcome(info, side.outcome),
            edge,
          });
        }
        if (!legs.length) continue;
        legs.sort((a, b) => (b.edge ?? 0) - (a.edge ?? 0) || b.odds - a.odds);
        const best = legs[0]!;
        const bestEdge = best.edge ?? 0;
        const fairOdds = 1 / side.p;
        const sharp = sharpSideRefs(byOutcome, oA, oB, side.outcome);
        const sharpNote = sharp.length
          ? `Fair ${fairOdds.toFixed(2)} · ${sharp.map((s) => `${s.book} ${s.odds.toFixed(2)}`).join(' · ')}`
          : `Fair ${fairOdds.toFixed(2)}`;
        const softNote =
          legs.length === 1
            ? `soft on ${best.book}`
            : `${legs.length} soft books · best ${best.book}`;
        const marketLabel = info?.winASet
          ? winASetLabel(side.outcome, event.home, event.away, info)
          : info?.label ?? key;
        ev.push({
          id: marketId(event.sport, event.eventId, key, 'ev', side.outcome),
          kind: 'ev',
          sport: boardSport,
          league: event.league,
          match,
          ...matchSides,
          ...subjectFields(boardSport, info),
          market: marketLabel,
          startMs: event.startMs,
          edgeLabel: `${pctLabel(bestEdge)} EV`,
          edge: bestEdge,
          note: `${sharpNote} · ${softNote}`,
          legs,
          sharp,
          fairOdds,
        });
      }
    }
  }

  // --- Middles: totals / handicaps with a gap between over and under lines ---
  middles.push(...scanMiddles(markets, meta, event, asOf, now, match, matchSides));

  return { arb, middles, ev };
}

function scanMiddles(
  markets: MarketMap,
  meta: Map<string, ParsedMarketMeta>,
  event: ToolsSnapshot['event'],
  asOf: Record<string, number>,
  now: number,
  match: string,
  sides: { home: string; away: string; homeImageUrl: string | null; awayImageUrl: string | null }
): ToolsOpportunity[] {
  const out: ToolsOpportunity[] = [];
  // Group total markets by base (without line).
  type LineSide = { line: number; key: string; over?: { book: string; odds: number }; under?: { book: string; odds: number } };
  const byBase = new Map<string, LineSide[]>();

  for (const [key, byOutcome] of markets) {
    const info = meta.get(key);
    if (!info || (info.family !== 'total' && info.family !== 'handicap') || info.line == null) continue;
    const base = key.replace(/\|[^|]+$/, '');
    const row: LineSide = { line: info.line, key };
    if (info.family === 'total') {
      const o = bestSoft(byOutcome.get('over') ?? new Map());
      const u = bestSoft(byOutcome.get('under') ?? new Map());
      if (o) row.over = o;
      if (u) row.under = u;
    } else {
      // Handicap middle: home at line L vs away at -L' where L < L' in home terms is awkward;
      // use opposing soft books on different home lines when over-line style gap exists.
      const home = bestSoft(byOutcome.get('home') ?? new Map());
      const away = bestSoft(byOutcome.get('away') ?? new Map());
      // Represent as synthetic over/under for window math: lower home line vs higher home line.
      if (home) row.over = home; // treat as "cover" side at this line
      if (away) row.under = away;
    }
    const list = byBase.get(base) ?? [];
    list.push(row);
    byBase.set(base, list);
  }

  for (const [base, rows] of byBase) {
    const info0 = meta.get(rows[0]!.key);
    if (info0?.family === 'total') {
      for (let i = 0; i < rows.length; i += 1) {
        for (let j = 0; j < rows.length; j += 1) {
          if (i === j) continue;
          const overRow = rows[i]!;
          const underRow = rows[j]!;
          if (!overRow.over || !underRow.under) continue;
          if (overRow.over.book === underRow.under.book) continue;
          const win = middleWindow(overRow.line, underRow.line);
          if (!win) continue;
          const width = win.high - win.low;
          if (width < MIN_MIDDLE_WIDTH) continue;
          if (!middleOddsOk(overRow.over.odds, underRow.under.odds)) continue;
          if (!freshEnough(asOf, [overRow.over.book, underRow.under.book], now)) continue;
          const stakes = middleStakes(overRow.over.odds, underRow.under.odds, 100);
          if (!stakes || stakes.riskLoss > MAX_MIDDLE_RISK) continue;
          const expect = middleExpected(width, stakes.riskLoss, stakes.middleCollect);
          if (!expect) continue;
          out.push({
            id: marketId(event.sport, event.eventId, base, 'middles', `${overRow.line}-${underRow.line}-${overRow.over.book}`),
            kind: 'middles',
            sport: event.sport as ToolsSport,
            league: event.league,
            match,
            ...sides,
            market: totalMiddleMarket(info0?.metric),
            startMs: event.startMs,
            edgeLabel: `${width.toFixed(1)} ${middleWindowUnit(info0?.metric)} gap`,
            edge: expect.expected / 100,
            note: `Middle ${win.low}–${win.high} · both bets can win`,
            middleRisk: stakes.riskLoss,
            middleCollect: stakes.middleCollect,
            middleWidth: width,
            middleHitProb: expect.hitProb,
            middleExpected: expect.expected,
            legs: [
              {
                book: displayBook(overRow.over.book),
                bookKey: overRow.over.book,
                selection: totalSideSelection('Over', overRow.line, info0?.metric),
                odds: overRow.over.odds,
                stake: stakes.stakeA,
                line: String(overRow.line),
              },
              {
                book: displayBook(underRow.under.book),
                bookKey: underRow.under.book,
                selection: totalSideSelection('Under', underRow.line, info0?.metric),
                odds: underRow.under.odds,
                stake: stakes.stakeB,
                line: String(underRow.line),
              },
            ],
          });
        }
      }
    } else if (info0?.family === 'handicap') {
      // Classic middle: home on the HIGHER home-line, away on the LOWER home-line.
      // e.g. home -2.5 + away +3.5 (home-line -3.5) → both win if home wins by 3.
      for (let i = 0; i < rows.length; i += 1) {
        for (let j = 0; j < rows.length; j += 1) {
          if (i === j) continue;
          const low = rows[i]!;
          const high = rows[j]!;
          if (!(low.line < high.line)) continue;
          if (!high.over || !low.under) continue; // home @ high, away @ low
          if (high.over.book === low.under.book) continue;
          const width = high.line - low.line;
          if (width < MIN_MIDDLE_WIDTH) continue;
          if (!middleOddsOk(high.over.odds, low.under.odds)) continue;
          if (!freshEnough(asOf, [high.over.book, low.under.book], now)) continue;
          const stakes = middleStakes(high.over.odds, low.under.odds, 100);
          if (!stakes || stakes.riskLoss > MAX_MIDDLE_RISK) continue;
          const expect = middleExpected(width, stakes.riskLoss, stakes.middleCollect);
          if (!expect) continue;
          const awayLine = -low.line;
          out.push({
            id: marketId(event.sport, event.eventId, base, 'middles', `hcp-${low.line}-${high.line}-${high.over.book}`),
            kind: 'middles',
            sport: event.sport as ToolsSport,
            league: event.league,
            match,
            ...sides,
            market: `${info0?.metric && /games?/i.test(info0.metric) ? 'Game handicap' : 'Handicap'} ${high.line > 0 ? '+' : ''}${high.line} / ${awayLine > 0 ? '+' : ''}${awayLine}`,
            startMs: event.startMs,
            edgeLabel: `${width.toFixed(1)} ${middleWindowUnit(info0?.metric)} gap`,
            edge: expect.expected / 100,
            note: `Both win if home margin is between ${low.line} and ${high.line}`,
            middleRisk: stakes.riskLoss,
            middleCollect: stakes.middleCollect,
            middleWidth: width,
            middleHitProb: expect.hitProb,
            middleExpected: expect.expected,
            legs: [
              {
                book: displayBook(high.over.book),
                bookKey: high.over.book,
                selection: `${event.home} ${high.line > 0 ? '+' : ''}${high.line}`,
                odds: high.over.odds,
                stake: stakes.stakeA,
                line: String(high.line),
              },
              {
                book: displayBook(low.under.book),
                bookKey: low.under.book,
                selection: `${event.away} ${awayLine > 0 ? '+' : ''}${awayLine}`,
                odds: low.under.odds,
                stake: stakes.stakeB,
                line: String(awayLine),
              },
            ],
          });
        }
      }
    }
  }

  // Dedupe by id, best expected (gap × payoff vs risk) first, cap per match.
  const seen = new Set<string>();
  const perMatch = new Map<string, number>();
  return out
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
    .sort(compareMiddles)
    .filter((r) => {
      const n = perMatch.get(r.match) ?? 0;
      if (n >= MAX_MIDDLES_PER_MATCH) return false;
      perMatch.set(r.match, n + 1);
      return true;
    });
}

/** Expected $ on $100 — wider windows + better payoff beat tight low-risk junk. */
function middleRankScore(op: ToolsOpportunity): number {
  if (op.middleExpected != null) return op.middleExpected;
  return (op.edge ?? 0) * 100;
}

function compareMiddles(a: ToolsOpportunity, b: ToolsOpportunity): number {
  return (
    middleRankScore(b) - middleRankScore(a) ||
    (b.middleWidth ?? 0) - (a.middleWidth ?? 0) ||
    a.startMs - b.startMs
  );
}

function capPerMatch(rows: ToolsOpportunity[], max: number): ToolsOpportunity[] {
  const counts = new Map<string, number>();
  return rows.filter((r) => {
    const n = counts.get(r.match) ?? 0;
    if (n >= max) return false;
    counts.set(r.match, n + 1);
    return true;
  });
}

export function scanOpportunities(snapshots: ToolsSnapshot[]): ToolsOpportunity[] {
  const now = Date.now();
  const arb: ToolsOpportunity[] = [];
  const middles: ToolsOpportunity[] = [];
  const ev: ToolsOpportunity[] = [];
  for (const snap of snapshots) {
    const found = scanEventOpportunities(snap, now);
    arb.push(...found.arb);
    middles.push(...found.middles);
    ev.push(...found.ev);
  }
  arb.sort((a, b) => b.edge - a.edge || a.startMs - b.startMs);
  ev.sort((a, b) => b.edge - a.edge || a.startMs - b.startMs);
  // middles already sorted/capped inside scanMiddles per event; re-sort globally
  middles.sort(compareMiddles);
  // All board = props-style "best first": mix kinds by quality, not ARB→EV→MID blocks.
  return [
    ...capPerMatch(arb, MAX_ARB_PER_MATCH),
    ...middles,
    ...capPerMatch(ev, MAX_EV_PER_MATCH),
  ].sort((a, b) => qualityScore(b) - qualityScore(a) || a.startMs - b.startMs);
}

/**
 * Cross-kind rank for All. ARBs are usually 0.5–2% locked — without a floor they
 * vanish under 10–20% EV cards. Floor ≈ 12% EV + 8× ROI so a 1% arb ≈ 20% EV.
 */
export function qualityScore(op: ToolsOpportunity): number {
  if (op.kind === 'arb') return 0.12 + op.edge * 8;
  if (op.kind === 'middles') {
    // expected $ on $100 → same scale as EV fraction (e.g. +12 ≈ 0.12)
    return middleRankScore(op) / 100;
  }
  return op.edge;
}

/**
 * All board order: round-robin best arb / EV / middle.
 * Pure quality sort lets wide middles (+$30–80 expected) bury everything else.
 */
export function interleaveBoardKinds(ops: ToolsOpportunity[]): ToolsOpportunity[] {
  const buckets: Record<'arb' | 'middles' | 'ev', ToolsOpportunity[]> = {
    arb: [],
    middles: [],
    ev: [],
  };
  for (const op of ops) {
    if (op.kind === 'arb' || op.kind === 'middles' || op.kind === 'ev') buckets[op.kind].push(op);
  }
  for (const list of Object.values(buckets)) {
    list.sort((a, b) => qualityScore(b) - qualityScore(a) || a.startMs - b.startMs);
  }
  const order: Array<'arb' | 'ev' | 'middles'> = ['arb', 'ev', 'middles'];
  const out: ToolsOpportunity[] = [];
  let i = 0;
  for (;;) {
    let added = false;
    for (const kind of order) {
      const next = buckets[kind][i];
      if (next) {
        out.push(next);
        added = true;
      }
    }
    if (!added) break;
    i += 1;
  }
  return out;
}

export function scanBonusFlips(
  snapshots: ToolsSnapshot[],
  opts: { bonus: number; bonusBook: string; heldBooks: string[] }
): ToolsBonusFlip[] {
  const bonusBook = canonBook(opts.bonusBook);
  const held = new Set(opts.heldBooks.map(canonBook).filter((b) => b && b !== bonusBook && isSoftBook(b)));
  if (!(opts.bonus > 0) || !bonusBook || !held.size) return [];
  const now = Date.now();
  const out: ToolsBonusFlip[] = [];

  for (const snap of snapshots) {
    const { event, items, asOf } = snap;
    const { markets, meta } = buildMarketMap(items, {
      sportApi: event.apiSport,
      includePlayerProps: true,
      home: event.home,
      away: event.away,
    });
    const match = `${event.home} vs ${event.away}`;
    const images = toolsMatchImages(event.sport, event.home, event.away);
    const sides = { home: event.home, away: event.away, ...images };

    for (const [key, byOutcome] of markets) {
      const outcomes = [...byOutcome.keys()];
      if (outcomes.length !== 2) continue;
      const info = meta.get(key);
      for (const [bonusSide, hedgeSide] of [
        [outcomes[0]!, outcomes[1]!],
        [outcomes[1]!, outcomes[0]!],
      ] as const) {
        const o1 = byOutcome.get(bonusSide)?.get(bonusBook);
        if (!o1) continue;
        let best: { book: string; odds: number } | null = null;
        for (const [book, odds] of byOutcome.get(hedgeSide)!) {
          if (!held.has(book)) continue;
          if (!best || odds > best.odds) best = { book, odds };
        }
        if (!best) continue;
        if (!saneTwoWay(o1, best.odds)) continue;
        if (!freshEnough(asOf, [bonusBook, best.book], now)) continue;
        const flip = bonusFlip(opts.bonus, o1, best.odds);
        if (!flip || flip.retention < MIN_BONUS_RETENTION) continue;
        // Prefer shorter-priced bonus legs (convert more reliably).
        if (o1 > 3.5) continue;
        out.push({
          id: marketId(event.sport, event.eventId, key, 'bonus', `${bonusSide}-${best.book}`),
          sport: event.sport,
          league: event.league,
          match,
          ...sides,
          ...subjectFields(event.sport, info),
          market: info?.label ?? key,
          startMs: event.startMs,
          convertLabel: `Convert ~$${flip.cashOut.toFixed(0)} · ${(flip.retention * 100).toFixed(1)}%`,
          cashOut: flip.cashOut,
          retention: flip.retention,
          bonusLeg: {
            book: displayBook(bonusBook),
            bookKey: bonusBook,
            selection: selectionWithLine(bonusSide, event.home, event.away, info),
            odds: o1,
            stake: opts.bonus,
            line: lineForOutcome(info, bonusSide),
          },
          hedgeLeg: {
            book: displayBook(best.book),
            bookKey: best.book,
            selection: selectionWithLine(hedgeSide, event.home, event.away, info),
            odds: best.odds,
            stake: flip.hedge,
            line: lineForOutcome(info, hedgeSide),
          },
        });
      }
    }
  }

  out.sort((a, b) => b.cashOut - a.cashOut || a.startMs - b.startMs);
  // Cap duplicates per match
  const seenMatch = new Map<string, number>();
  return out.filter((r) => {
    const n = seenMatch.get(r.match) ?? 0;
    if (n >= 3) return false;
    seenMatch.set(r.match, n + 1);
    return true;
  });
}

/** Tiny helper for tests / unused import guard. */
export function _isSharp(book: string): boolean {
  return isSharpBook(book);
}
