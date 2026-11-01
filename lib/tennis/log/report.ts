/**
 * Weekly tennis report (spec sections 13, 15 and 16; lean build: the analysis reads what the logger kept).
 *   - coverage: matches, arms, quotes, feed health;
 *   - the candidate universe by fair_source and market, and executable opportunities (+10 min);
 *   - would-be bets: results, CLV split, vanished share;
 *   - completion rates by tour and tier;
 *   - pilot: the information regression, the would-be bets' EV and the minimum detectable edge;
 *   - Pinnacle derivation: is its handicap / games-won pricing a function of its winner and total?
 * Nothing here feeds back into the logger or the frozen v0 policy.
 */

import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { makeModel, priceIntegrated, type SetRule } from '@/lib/tennis/model/pricing';
import { gradeForBook } from './bookRules';
import { readTennisLogHealth, type TennisLogHealth } from './health';
import { derivationVerdict, type DerivationVerdict, type MisfitRow, type PollChange } from './derivation';
import { DEFAULT_DEVIG, type Devig } from './devig';
import { invertArm, matchRules, MIN_EV, type SharpFair } from './fair';
import { gradeSelection, type MatchOutcome, type SetScore } from './grade';
import type { LogMarket } from './quotes';
import { clusteredMean, executableAfter, informationWithCi, mdePlan, type InfoResult, type InfoRow, type MdePlan, type PricePoint } from './reportMath';

const REPORT_KEY = 'tennis_model_report_v1';
const REPORT_TTL_S = 120 * 24 * 60 * 60;
const DAY = 24 * 60 * 60_000;
/** Pending owner decision (spec section 15): fixed horizon at the end of 2027. */
const HORIZON = '2027-12-31';
/** Provisional price-noise SD in logit units until noise is measured from repeat quotes. */
const PROVISIONAL_NOISE_LOGIT = 0.1;
const DERIVATION_ARMS = 200;
const FEEDS = ['oddsnet', ...['betright', 'ladbrokes', 'neds', 'pointsbet', 'unibet'].map((b) => `scraper:${b}`)];

const logit = (p: number) => Math.log(p / (1 - p));

type MatchRow = {
  match_id: string;
  tour: string | null;
  tier: string | null;
  best_of: number;
  is_grand_slam: boolean;
  status: string;
  set_scores: SetScore[] | null;
  graded_at: string | null;
  scheduled_start: string | null;
  winner_side?: 'home' | 'away' | null;
};

/** Every row of a select, 1000 at a time. */
async function selectAll<T>(table: string, columns: string, filter: (q: any) => any = (q) => q, cap = 200_000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < cap; from += 1000) {
    const { data, error } = await filter(supabaseAdmin.from(table).select(columns)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function count(table: string, filter: (q: any) => any = (q) => q): Promise<number | null> {
  const { count: n, error } = await filter(supabaseAdmin.from(table).select('*', { count: 'exact', head: true }));
  return error ? null : n ?? 0;
}

function outcomeOf(m: MatchRow): MatchOutcome | null {
  if (!m.graded_at || !['completed', 'retired', 'default', 'walkover'].includes(m.status)) return null;
  return { status: m.status as MatchOutcome['status'], sets: m.set_scores ?? [], winner: m.winner_side ?? null };
}

export type TennisWeeklyReport = {
  generatedAt: string;
  policyVersion: string;
  coverage: {
    matches: number;
    matchesLast7d: number;
    graded: number;
    arms: Record<string, number>;
    armsWithModel: number;
    quotes: number | null;
    feedOkRate7d: Record<string, { ok: number | null; failed: number | null }>;
  };
  candidates: Array<{ fairSource: string; market: string; sides: number; evAtLeastMin: number }>;
  opportunities: { qualifying: number; checked: number; executable10m: number; share: number | null };
  shadow: {
    bets: number;
    graded: Record<string, number>;
    /** Settled under each bet's book rules (Option A); the house rule is the sensitivity check. */
    units: number;
    unitsHouseRule: number;
    clvTotal: ReturnType<typeof clusteredMean>;
    clvA: ReturnType<typeof clusteredMean>;
    clvB: ReturnType<typeof clusteredMean>;
    vanishedShare: number | null;
    vanishedChecked: number;
  };
  completion: Array<{ tour: string; tier: string; graded: number; completed: number; retired: number; walkover: number; unknown: number }>;
  pilot: { info: InfoResult | null; plan: MdePlan | null; horizon: string; note: string };
  derivation: { noiseLogit: number; noiseByMarket: Record<string, { sd: number; n: number }>; verdicts: Array<DerivationVerdict & { market: string }>; note: string };
  /** The latest daily integrity check. */
  health: TennisLogHealth | null;
};

/** Executable opportunities: qualifying sharp_direct main-arm sides still on offer 10 minutes later. */
async function opportunities(rows: Array<{ match_id: string; captured_at: string; book: string; market: string; line: number | null; selection: string; price: number }>): Promise<TennisWeeklyReport['opportunities']> {
  const byMatch = new Map<string, typeof rows>();
  for (const r of rows) byMatch.set(r.match_id, [...(byMatch.get(r.match_id) ?? []), r]);
  let checked = 0;
  let executable = 0;
  for (const [matchId, cands] of byMatch) {
    const quotes = await selectAll<{ feed: string; book: string; market: string; line: number | null; selection: string; price: number; first_seen_at: string }>(
      'tennis_quotes',
      'feed, book, market, line, selection, price, first_seen_at',
      (q) => q.eq('match_id', matchId).order('first_seen_at', { ascending: true }),
      20_000
    );
    for (const c of cands) {
      const same = quotes.filter((q) => q.book === c.book && q.market === c.market && q.selection === c.selection && (c.line == null ? q.line == null : q.line != null && Math.abs(Number(q.line) - Number(c.line)) < 0.01));
      const feed = same.some((q) => q.feed === 'oddsnet') ? 'oddsnet' : same[0]?.feed;
      const history: PricePoint[] = same.filter((q) => q.feed === feed).map((q) => ({ ms: Date.parse(q.first_seen_at), price: Number(q.price) }));
      const ok = executableAfter(history, Date.parse(c.captured_at), Number(c.price), 10);
      if (ok == null) continue;
      checked += 1;
      if (ok) executable += 1;
    }
  }
  return { qualifying: rows.length, checked, executable10m: executable, share: checked ? executable / checked : null };
}

/**
 * Price noise per market from Pinnacle and Betfair pricing the same line at the same arm: the logit gap between
 * two independent noisy readings has variance 2 sigma^2, so sigma = SD(gap) / sqrt(2).
 */
function sharpNoise(arms: Array<{ sharp: SharpFair[] }>): Record<string, { sd: number; n: number }> {
  const gaps: Record<string, number[]> = {};
  for (const arm of arms) {
    for (const f of arm.sharp ?? []) {
      const pin = (f.byBook as Record<string, Devig | undefined>)?.pinnacle?.[DEFAULT_DEVIG][0];
      const bf = (f.byBook as Record<string, Devig | undefined>)?.betfair?.[DEFAULT_DEVIG][0];
      if (!(pin! > 0.02 && pin! < 0.98 && bf! > 0.02 && bf! < 0.98)) continue;
      (gaps[f.market] ??= []).push(logit(pin!) - logit(bf!));
    }
  }
  const out: Record<string, { sd: number; n: number }> = {};
  for (const [market, xs] of Object.entries(gaps)) {
    const mean = xs.reduce((a, v) => a + v, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, v) => a + (v - mean) ** 2, 0) / Math.max(1, xs.length - 1)) / Math.SQRT2;
    out[market] = { sd, n: xs.length };
  }
  return out;
}

const NOISE_MIN_PAIRS = 30;

/** Pinnacle's derivative prices against its own winner + total, through the DP at the provisional tau / rho. */
function derivationRows(arms: Array<{ match_id: string; sharp: SharpFair[] }>, matches: Map<string, MatchRow>, noise: Record<string, { sd: number; n: number }>): { handicap: MisfitRow[]; gamesWon: MisfitRow[] } {
  const noiseOf = (market: string) => {
    const m = noise[market];
    return m && m.n >= NOISE_MIN_PAIRS && m.sd > 0 ? m.sd : PROVISIONAL_NOISE_LOGIT;
  };
  const handicap: MisfitRow[] = [];
  const gamesWon: MisfitRow[] = [];
  for (const arm of arms) {
    const m = matches.get(arm.match_id);
    if (!m) continue;
    const pin = (arm.sharp ?? [])
      .map((f) => {
        const d = (f.byBook as Record<string, Devig | undefined>)?.pinnacle;
        return d ? { ...f, p: d[DEFAULT_DEVIG][0] } : null;
      })
      .filter((f): f is SharpFair => f != null);
    const inputs = pin.filter((f) => f.market === 'match_winner' || f.market === 'total_games');
    const win = inputs.find((f) => f.market === 'match_winner');
    const totals = inputs.filter((f) => f.market === 'total_games' && f.line != null).sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5));
    const targets = pin.filter((f) => (f.market === 'game_handicap' || f.market === 'games_won') && f.line != null);
    if (!win || !totals.length || !targets.length) continue;
    const rules = matchRules(m.best_of, m.is_grand_slam) as { ruleN: SetRule; ruleF: SetRule };
    let model;
    try {
      model = invertArm([win, totals[0]!], m.best_of, rules);
    } catch {
      continue;
    }
    if (!model) continue;
    const keys = targets.map((f) => (f.market === 'game_handicap' ? `hcp:${f.line}` : `${f.base.startsWith('home') ? 'gA' : 'gB'}:${f.line}`));
    let prices: Record<string, number>;
    try {
      prices = priceIntegrated(model.theta, model.cov, model.tau, makeModel(keys, m.best_of, rules.ruleN, rules.ruleF), model.order, model.rho);
    } catch {
      continue;
    }
    targets.forEach((f, i) => {
      const pred = prices[keys[i]!];
      if (!(pred! > 0.001 && pred! < 0.999) || !(f.p > 0.001 && f.p < 0.999)) return;
      const misfit = logit(f.p) - logit(pred!);
      const row: MisfitRow = {
        match: arm.match_id,
        tier: m.tier ?? 'unknown',
        z: misfit / noiseOf(f.market),
        misfit,
        logitWin: logit(win.p),
        totalLine: Number(totals[0]!.line),
        hcpLine: f.market === 'game_handicap' ? Number(f.line) : Number(f.line) - Number(totals[0]!.line) / 2,
      };
      (f.market === 'game_handicap' ? handicap : gamesWon).push(row);
    });
  }
  return { handicap, gamesWon };
}

/** Pinnacle price changes per poll over the last week, labelled winner / total / derivative. */
async function pinnacleMoves(sinceIso: string): Promise<PollChange[]> {
  const rows = await selectAll<{ match_id: string; market: string; line: number | null; selection: string; first_seen_at: string }>(
    'tennis_quotes',
    'match_id, market, line, selection, first_seen_at',
    (q) => q.eq('book', 'pinnacle').eq('feed', 'oddsnet').gte('first_seen_at', sinceIso).order('first_seen_at', { ascending: true }),
    60_000
  );
  const seen = new Set<string>();
  const out: PollChange[] = [];
  for (const r of rows) {
    const key = `${r.match_id}|${r.market}|${r.line ?? ''}|${r.selection}`;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    const market = r.market === 'match_winner' ? 'winner' : r.market === 'total_games' ? 'total' : r.market === 'game_handicap' || r.market === 'games_won' ? 'derivative' : null;
    if (market) out.push({ match: r.match_id, pollAt: r.first_seen_at, market });
  }
  return out;
}

export async function buildTennisWeeklyReport(nowMs = Date.now()): Promise<TennisWeeklyReport> {
  const since7 = new Date(nowMs - 7 * DAY).toISOString();
  const since28 = new Date(nowMs - 28 * DAY).toISOString();

  const matchCols = 'match_id, tour, tier, best_of, is_grand_slam, status, set_scores, graded_at, scheduled_start';
  // winner_side arrives with migrations/tennis_book_void_rules.sql.
  const matchRows = await selectAll<MatchRow>('tennis_matches', `${matchCols}, winner_side`).catch(() => selectAll<MatchRow>('tennis_matches', matchCols));
  const matches = new Map(matchRows.map((m) => [m.match_id, m]));
  const arms = await selectAll<{ match_id: string; arm: string; captured_at: string; sharp: SharpFair[]; model: unknown }>('tennis_arm_snapshots', 'match_id, arm, captured_at, sharp, model');

  const feedOkRate7d: TennisWeeklyReport['coverage']['feedOkRate7d'] = {};
  for (const feed of FEEDS) {
    feedOkRate7d[feed] = {
      ok: await count('tennis_poll_heartbeats', (q) => q.eq('feed', feed).eq('ok', true).gte('polled_at', since7)),
      failed: await count('tennis_poll_heartbeats', (q) => q.eq('feed', feed).eq('ok', false).gte('polled_at', since7)),
    };
  }
  const armCounts: Record<string, number> = {};
  for (const a of arms) armCounts[a.arm] = (armCounts[a.arm] ?? 0) + 1;

  // The candidate universe at the main arm.
  const mainCands = await selectAll<{ match_id: string; captured_at: string; book: string; market: string; line: number | null; selection: string; price: number; q: number | null; edge: number | null; ev: number; fair_source: string }>(
    'tennis_candidates',
    'match_id, captured_at, book, market, line, selection, price, q, edge, ev, fair_source',
    (q) => q.eq('arm', 'main')
  );
  const universe = new Map<string, { fairSource: string; market: string; sides: number; evAtLeastMin: number }>();
  for (const c of mainCands) {
    const key = `${c.fair_source}|${c.market}`;
    const row = universe.get(key) ?? { fairSource: c.fair_source, market: c.market, sides: 0, evAtLeastMin: 0 };
    row.sides += 1;
    if (Number(c.ev) >= MIN_EV) row.evAtLeastMin += 1;
    universe.set(key, row);
  }
  const qualifying = mainCands.filter((c) => c.fair_source === 'sharp_direct' && Number(c.ev) >= MIN_EV && c.captured_at >= since28);

  // Would-be bets.
  type BetRow = { match_id: string; price: number; result: string | null; result_house?: string | null; vanished: boolean | null; clv: { total?: number; a?: number; b?: number } | null };
  const betCols = 'match_id, price, result, vanished, clv';
  const bets = await selectAll<BetRow>('tennis_shadow_bets', `${betCols}, result_house`).catch(() => selectAll<BetRow>('tennis_shadow_bets', betCols));
  const graded: Record<string, number> = {};
  const unitsOf = (r: string | null | undefined, price: number) => (r === 'win' ? price - 1 : r === 'loss' ? -1 : 0);
  let units = 0;
  let unitsHouse = 0;
  for (const b of bets) {
    if (!b.result) continue;
    graded[b.result] = (graded[b.result] ?? 0) + 1;
    units += unitsOf(b.result, Number(b.price));
    unitsHouse += unitsOf(b.result_house ?? b.result, Number(b.price));
  }
  const clvRows = (k: 'total' | 'a' | 'b') => bets.filter((b) => b.clv && Number.isFinite(b.clv[k])).map((b) => ({ match: b.match_id, v: Number(b.clv![k]) }));
  const vanishedChecked = bets.filter((b) => b.vanished != null);

  // Completion rates.
  const completionMap = new Map<string, TennisWeeklyReport['completion'][number]>();
  for (const m of matchRows) {
    if (!m.graded_at) continue;
    const key = `${m.tour ?? '?'}|${m.tier ?? '?'}`;
    const row = completionMap.get(key) ?? { tour: m.tour ?? '?', tier: m.tier ?? '?', graded: 0, completed: 0, retired: 0, walkover: 0, unknown: 0 };
    row.graded += 1;
    if (m.status === 'completed') row.completed += 1;
    else if (m.status === 'retired' || m.status === 'default') row.retired += 1;
    else if (m.status === 'walkover') row.walkover += 1;
    else row.unknown += 1;
    completionMap.set(key, row);
  }

  // Pilot: graded sharp_direct main-arm sides; pushes and voids left out.
  const infoRows: InfoRow[] = [];
  for (const c of mainCands) {
    if (c.fair_source !== 'sharp_direct' || c.q == null || c.edge == null) continue;
    const m = matches.get(c.match_id);
    const outcome = m && outcomeOf(m);
    if (!outcome) continue;
    const line = c.line == null ? null : Number(c.line);
    const house = gradeSelection(c.market as LogMarket, line, c.selection, outcome);
    const g = gradeForBook(c.book, c.market as LogMarket, line, c.selection, outcome, m.best_of, house).grade;
    if (g !== 'win' && g !== 'loss') continue;
    infoRows.push({ match: c.match_id, y: g === 'win' ? 1 : 0, q: Number(c.q), edge: Number(c.edge), price: Number(c.price) });
  }
  const info = informationWithCi(infoRows, MIN_EV);
  const qualifyingMatches28 = new Set(qualifying.map((c) => c.match_id)).size;
  const daysLeft = Math.max(0, (Date.parse(`${HORIZON}T23:59:59Z`) - nowMs) / DAY);
  const plan = info && Number.isFinite(info.evSe) ? mdePlan(info.evSe, info.matches, info.matches + Math.round((qualifyingMatches28 / 28) * daysLeft)) : null;

  // Pinnacle derivation on the most recent main arms.
  const recentMain = arms.filter((a) => a.arm === 'main').sort((a, b) => b.captured_at.localeCompare(a.captured_at)).slice(0, DERIVATION_ARMS);
  const noise = sharpNoise(arms.filter((a) => a.arm === 'main'));
  const der = derivationRows(recentMain, matches, noise);
  const moves = await pinnacleMoves(since7).catch(() => null);
  const verdicts: TennisWeeklyReport['derivation']['verdicts'] = [];
  for (const [market, rows] of [['game_handicap', der.handicap], ['games_won', der.gamesWon]] as const) {
    if (!rows.length) continue;
    verdicts.push({ market, ...derivationVerdict('all', rows, moves) });
    for (const tier of [...new Set(rows.map((r) => r.tier))]) {
      const sub = rows.filter((r) => r.tier === tier);
      if (new Set(sub.map((r) => r.match)).size >= 20) verdicts.push({ market, ...derivationVerdict(tier, sub, null) });
    }
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    policyVersion: 'tennis-v0-1',
    coverage: {
      matches: matchRows.length,
      matchesLast7d: matchRows.filter((m) => (m.scheduled_start ?? '') >= since7).length,
      graded: matchRows.filter((m) => m.graded_at).length,
      arms: armCounts,
      armsWithModel: arms.filter((a) => a.model).length,
      quotes: await count('tennis_quotes'),
      feedOkRate7d,
    },
    candidates: [...universe.values()].sort((a, b) => a.fairSource.localeCompare(b.fairSource) || a.market.localeCompare(b.market)),
    opportunities: await opportunities(qualifying),
    shadow: {
      bets: bets.length,
      graded,
      units: Math.round(units * 100) / 100,
      unitsHouseRule: Math.round(unitsHouse * 100) / 100,
      clvTotal: clusteredMean(clvRows('total')),
      clvA: clusteredMean(clvRows('a')),
      clvB: clusteredMean(clvRows('b')),
      vanishedShare: vanishedChecked.length ? vanishedChecked.filter((b) => b.vanished).length / vanishedChecked.length : null,
      vanishedChecked: vanishedChecked.length,
    },
    completion: [...completionMap.values()].sort((a, b) => b.graded - a.graded),
    pilot: {
      info,
      plan,
      horizon: HORIZON,
      note: info
        ? 'Information regression on graded sharp_direct main-arm sides (pushes/voids out); EV is the mean model EV of sides with raw EV >= 3%. Horizon is pending owner sign-off.'
        : 'Fewer than 20 graded matches with sharp_direct candidates: no pilot yet.',
    },
    derivation: {
      noiseLogit: PROVISIONAL_NOISE_LOGIT,
      noiseByMarket: noise,
      verdicts,
      note: `Pinnacle winner + main total inverted at the provisional tau/rho; misfits standardised by each market's measured noise (Pinnacle vs Betfair on the same line, SD/sqrt 2) once it has ${NOISE_MIN_PAIRS}+ pairs, else the provisional ${PROVISIONAL_NOISE_LOGIT}.`,
    },
    health: await readTennisLogHealth().catch(() => null),
  };
}

export async function saveTennisWeeklyReport(report: TennisWeeklyReport): Promise<void> {
  await sharedCache.setJSON(REPORT_KEY, report, REPORT_TTL_S);
  await sharedCache.setJSON(`${REPORT_KEY}:${report.generatedAt.slice(0, 10)}`, report, REPORT_TTL_S);
}
