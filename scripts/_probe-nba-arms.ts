/**
 * The NBA shadow arms at a glance. Read-only: nothing is written anywhere.
 *
 *   npx tsx scripts/_probe-nba-arms.ts            build this week's scoreboard from the tables
 *   npx tsx scripts/_probe-nba-arms.ts --saved    print the scoreboard the weekly cron last saved
 *   npx tsx scripts/_probe-nba-arms.ts --replay   run every arm over the latest logged slate (no writes)
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import type { ArmScoreboard, GateSummary } from '@/lib/nba/model/scoreboard';

const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '   n/a' : `${v >= 0 ? '+' : ''}${(100 * v).toFixed(2)}%`);

function printGate(label: string, g: GateSummary) {
  const lift = g.liftVsMarket ? `lift vs market ${g.liftVsMarket.mean.toFixed(5)} [${g.liftVsMarket.lo.toFixed(5)}, ${g.liftVsMarket.hi.toFixed(5)}] over ${g.liftVsMarket.games} games` : 'not fitted yet';
  console.log(`  ${label}: ${g.status}, ${g.lines} lines, ${g.dates} ET dates, ${lift} -> promote ${g.promoteShadow ? 'YES' : 'no'}`);
}

function printScoreboard(board: ArmScoreboard) {
  console.log(`NBA shadow arms, as of ${board.generatedAt}\n`);
  for (const a of board.arms) {
    console.log(`Arm ${a.id}  ${a.name}  (policy ${a.policyVersion}, model ${a.modelVersion})`);
    console.log(`  ${a.purpose}`);
    console.log(`  bets ${a.counts.bets} recorded, ${a.counts.confirmed} confirmed, ${a.counts.withClv} with CLV, ${a.counts.games} games; by trigger ${JSON.stringify(a.counts.byTrigger)}`);
    for (const [name, c] of [['total', a.clv.total], ['(a) price', a.clv.a], ['(b) drift', a.clv.b]] as const) {
      console.log(`  CLV ${name.padEnd(9)} ${pct(c.mean)}  95% [${pct(c.lo)}, ${pct(c.hi)}]  99% lower ${pct(c.lo99)}`);
    }
    const need = a.measurement.betsNeeded == null ? 'not measured yet' : `${a.measurement.betsNeeded} bets needed (${a.measurement.status}${a.measurement.status === 'provisional' && a.measurement.fixedAt ? `, fixed on ${a.measurement.fixedAt.slice(0, 10)}` : ''})`;
    console.log(`  sample: ${a.measurement.betsWithClv} bets with CLV; ${need}`);
    console.log(`  reopen: ${a.reopen.ready ? 'READY' : 'no'}${a.missingForLive.length ? ` (missing: ${a.missingForLive.join('; ')})` : ''}`);
    console.log(`  futility: ${a.futility.stop ? 'STOP' : 'no'} (total CLV 95% upper ${pct(a.futility.upper95)}, stop below +1.00%)`);
    for (const r of a.readings) console.log(`  - ${r}`);
    console.log('');
  }
  for (const f of board.failed ?? []) console.log(`Arm ${f.id} ${f.name}: report FAILED this week: ${f.error}\n`);
  console.log('Residual fit (coefficients for arm A):');
  printGate('all lines   ', board.residual.allLines);
  printGate(`sound inputs`, board.residual.cleanInputs);
  console.log(`  sound inputs are feature versions ${board.residual.cleanFeatureVersions.join(', ')}; promote coefficients: ${board.residual.promoteShadow ? 'YES' : 'no'}`);
  for (const r of board.residual.readings) console.log(`  - ${r}`);
  console.log(`\nLive posting from an arm: ${board.livePosting.enabled ? 'switched ON' : 'OFF (default)'}; promotable arm: ${board.livePosting.promotable ?? 'none'}`);
}

/** Every arm over the latest logged slate, with all prices taken as held, to check counts, isolation and cost. */
async function replay() {
  const { supabaseAdmin: db } = await import('@/lib/supabaseAdmin');
  const { ARMS } = await import('@/lib/nba/propLog/arms');
  const { etDay } = await import('@/lib/nba/propLog/featureRules');
  const { memoryKey, wouldBeBets, dropRepeatNews } = await import('@/lib/nba/propLog/shadowBets');
  type Trigger = import('@/lib/nba/propLog/shadowBets').Trigger;
  type LoggedQuote = import('@/lib/nba/propLog/lines').LoggedQuote;
  type PriceMemory = import('@/lib/nba/propLog/shadowRules').PriceMemory;

  const { data: latest } = await db.from('nba_prop_snapshots').select('tip_at').eq('snapshot_kind', 't2h').order('tip_at', { ascending: false }).limit(1);
  if (!latest?.[0]) return console.log('no t2h snapshots logged');
  const day = etDay(latest[0].tip_at);
  const from = new Date(Date.parse(latest[0].tip_at) - 30 * 3600_000).toISOString();
  type Snap = { id: string; game_id: string; tip_at: string; player_id: string | null; player_name: string; board_name: string; team: string | null; stat: string; snapshot_kind: 't2h' | 'injury_change' | 'us_move'; captured_at: string; main_line: number; n_books: number; book_dispersion: number | null; fair_over_all: number | null; fair_over_us: number | null; best_au_over: number | null; best_au_over_book: string | null; best_au_under: number | null; best_au_under_book: string | null; features: Record<string, unknown> | null; model_version: string; feature_version: string };
  const snaps: Snap[] = [];
  for (let at = 0; ; at += 1000) {
    const { data, error } = await db
      .from('nba_prop_snapshots')
      .select('id, game_id, tip_at, player_id, player_name, board_name, team, stat, snapshot_kind, captured_at, main_line, n_books, book_dispersion, fair_over_all, fair_over_us, best_au_over, best_au_over_book, best_au_under, best_au_under_book, features, model_version, feature_version')
      .in('snapshot_kind', ['t2h', 'injury_change', 'us_move'])
      .gte('tip_at', from)
      .order('id')
      .range(at, at + 999);
    if (error) throw new Error(error.message);
    snaps.push(...((data ?? []) as Snap[]).filter((s) => etDay(s.tip_at) === day));
    if ((data?.length ?? 0) < 1000) break;
  }
  const quotes = new Map<string, LoggedQuote[]>();
  const ids = snaps.map((s) => s.id);
  for (let i = 0; i < ids.length; i += 100) {
    for (let at = 0; ; at += 1000) {
      const { data, error } = await db.from('nba_prop_book_quotes').select('snapshot_id, book, line, over_price, under_price, source_ts, coherent').in('snapshot_id', ids.slice(i, i + 100)).order('snapshot_id').order('book').range(at, at + 999);
      if (error) throw new Error(error.message);
      for (const q of data ?? []) quotes.set(q.snapshot_id, [...(quotes.get(q.snapshot_id) ?? []), { book: q.book, line: Number(q.line), over: q.over_price, under: q.under_price, sourceTs: q.source_ts, coherent: q.coherent }]);
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  // One logger run = one capture time. Prices are taken as first seen 15 minutes before it.
  const runs = new Map<string, Trigger[]>();
  for (const s of snaps) {
    const q = quotes.get(s.id) ?? [];
    const best = (price: number | null, book: string | null) => (price != null && book ? { price: Number(price), book } : null);
    const trigger: Trigger = {
      snapshotId: s.id,
      kind: s.snapshot_kind,
      row: { game_id: s.game_id, tip_at: s.tip_at, player_id: s.player_id, stat: s.stat, main_line: Number(s.main_line), n_books: s.n_books, book_dispersion: s.book_dispersion, features: s.features ?? {}, model_version: s.model_version, feature_version: s.feature_version },
      line: {
        boardName: s.board_name,
        player: s.player_id ? { id: s.player_id, name: s.player_name, teamCode: s.team ?? '' } : null,
        stat: s.stat,
        mainLine: Number(s.main_line),
        quotes: q,
        nBooks: s.n_books,
        bookDispersion: s.book_dispersion,
        fairOverAll: s.fair_over_all,
        fairOverUs: s.fair_over_us,
        bestAuOver: best(s.best_au_over, s.best_au_over_book),
        bestAuUnder: best(s.best_au_under, s.best_au_under_book),
      } as Trigger['line'],
    };
    runs.set(s.captured_at, [...(runs.get(s.captured_at) ?? []), trigger]);
  }
  const all: ReturnType<typeof wouldBeBets>['bets'] = [];
  const errors: string[] = [];
  const t0 = performance.now();
  for (const [capturedAt, triggers] of runs) {
    const nowMs = Date.parse(capturedAt);
    const seenAt = new Date(nowMs - 15 * 60_000).toISOString();
    const memory: Record<string, PriceMemory> = {};
    for (const t of triggers) memory[memoryKey(t.row.game_id, t.line.boardName, t.line.stat)] = Object.fromEntries(t.line.quotes.filter((q) => q.line === t.line.mainLine).map((q) => [q.book, { over: q.over, under: q.under, seenAt }]));
    const out = wouldBeBets(triggers, memory, nowMs);
    all.push(...out.bets);
    errors.push(...out.errors);
  }
  const ms = performance.now() - t0;
  const bets = dropRepeatNews(all, []);
  const kinds = (k: string) => snaps.filter((s) => s.snapshot_kind === k).length;
  console.log(`Replay of ${day} (ET): ${kinds('t2h')} t2h, ${kinds('injury_change')} injury_change, ${kinds('us_move')} us_move snapshots in ${runs.size} logger runs`);
  console.log(`Deciding every arm on all of them took ${ms.toFixed(0)}ms in total (${(ms / Math.max(1, runs.size)).toFixed(1)}ms per run). Nothing was written.`);
  if (errors.length) console.log(`arm errors: ${[...new Set(errors)].join('; ')}`);
  const keys = new Set(bets.map((b) => `${b.policy}|${b.policy_version}|${b.trigger_snapshot_id}|${b.side}`));
  console.log(`${bets.length} would-be bets, ${keys.size} distinct table keys (policy, policy_version, trigger, side)${keys.size === bets.length ? ': no collisions' : ': COLLISION'}`);
  for (const arm of ARMS) {
    const mine = bets.filter((b) => b.policy_version === arm.policyVersion);
    const by = (f: (b: (typeof mine)[number]) => string) => JSON.stringify(Object.fromEntries([...new Set(mine.map(f))].sort().map((k) => [k, mine.filter((b) => f(b) === k).length])));
    console.log(`  Arm ${arm.id} ${arm.name.padEnd(15)} ${String(mine.length).padStart(4)} bets (${mine.filter((b) => b.price_confirmed).length} at a held price)  trigger ${by((b) => String(b.features.trigger))}  side ${by((b) => b.side)}`);
  }
  const shared = new Map<string, Set<string>>();
  for (const b of bets) shared.set(b.trigger_snapshot_id, (shared.get(b.trigger_snapshot_id) ?? new Set()).add(String(b.features.arm)));
  console.log(`  snapshots bet by more than one arm: ${[...shared.values()].filter((s) => s.size > 1).length}`);
  console.log('Notes: prices are assumed held for 15 minutes, so confirmed counts are an upper bound. Arm C needs the US move detail and the news clock,');
  console.log('which are only logged from inputs-v6 on, so it reads zero on slates logged before that.');
}

async function main() {
  if (process.argv.includes('--replay')) {
    await replay();
    process.exit(0);
  }
  let board: ArmScoreboard | null;
  if (process.argv.includes('--saved')) {
    const { default: sharedCache } = await import('@/lib/sharedCache');
    const { ARMS_KEY } = await import('@/lib/nba/model/reportData');
    board = await sharedCache.getJSON<ArmScoreboard>(ARMS_KEY);
    if (!board) {
      console.log('No scoreboard saved yet (the weekly cron writes it on Mondays). Run without --saved to build it now.');
      process.exit(0);
    }
  } else {
    const { buildWeeklyReport } = await import('@/lib/nba/model/reportData');
    const t = Date.now();
    board = (await buildWeeklyReport()).scoreboard;
    console.log(`(built from the tables in ${Date.now() - t}ms; not saved)\n`);
  }
  printScoreboard(board);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
