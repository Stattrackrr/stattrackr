/**
 * Orchestrates tools scans from cron-backed Redis boards (ARB/EV/MID).
 * Bonus Flipper Find is cache-only — odds-api.net only via warm-tools-bonus cron.
 */

import {
  bonusCacheKey,
  OPPORTUNITIES_HOT_MS,
  OPPORTUNITIES_SOFT_MS,
  opportunitiesCacheKey,
  opportunitiesCacheRead,
  opportunitiesCacheWrite,
  toolsCacheGet,
  toolsCacheSet,
  type BonusPayload,
  type OpportunitiesPayload,
} from './cache';
import { BONUS_BOARD_MAX_AGE_MS, readBonusLiveBoard } from './bonusWarm';
import { canonBook } from './books';
import type { ToolsSnapshot } from './fetch';
import { loadToolsSnapshotsFromBoards } from './fromBoard';
import { interleaveBoardKinds, qualityScore, scanBonusFlips, scanOpportunities } from './scan';
import type { ToolsOpportunity, ToolsSport } from './types';

/** Keep each tool tab populated — a flat top-N by quality can wipe EV under ARB/MID. */
function takeBoardOpportunities(ops: ToolsOpportunity[], limit = 150): ToolsOpportunity[] {
  const minEach = 35;
  const byKind: Record<'arb' | 'middles' | 'ev', ToolsOpportunity[]> = {
    arb: [],
    middles: [],
    ev: [],
  };
  for (const op of ops) {
    if (op.kind === 'arb' || op.kind === 'middles' || op.kind === 'ev') byKind[op.kind].push(op);
  }
  const picked = new Set<string>();
  const out: ToolsOpportunity[] = [];
  for (const list of [byKind.arb, byKind.middles, byKind.ev]) {
    for (const op of list.slice(0, minEach)) {
      if (picked.has(op.id)) continue;
      picked.add(op.id);
      out.push(op);
    }
  }
  // Fill remaining slots by quality, but still keep kind quotas from starving All.
  const byQuality = [...ops].sort((a, b) => qualityScore(b) - qualityScore(a) || a.startMs - b.startMs);
  for (const op of byQuality) {
    if (out.length >= limit) break;
    if (picked.has(op.id)) continue;
    picked.add(op.id);
    out.push(op);
  }
  return interleaveBoardKinds(out);
}

const refreshInFlight = new Map<string, Promise<OpportunitiesPayload>>();

const ALL_SPORTS: ToolsSport[] = ['tennis', 'nbl', 'nba'];

export function resolveSports(sport: string | null | undefined): ToolsSport[] {
  const s = String(sport || 'all').toLowerCase();
  if (s === 'tennis' || s === 'nbl' || s === 'nba') return [s];
  return ALL_SPORTS;
}

/** Freshest book as-of across all board snapshots (ms). */
function boardAsOfMs(snapshots: ToolsSnapshot[]): number {
  let max = 0;
  for (const snap of snapshots) {
    for (const t of Object.values(snap.asOf || {})) {
      if (typeof t === 'number' && t > max) max = t;
    }
  }
  return max;
}

async function snapshotsForSports(sports: ToolsSport[]): Promise<{
  snapshots: ToolsSnapshot[];
  fromBoard: ToolsSport[];
  asOfMs: number;
}> {
  const board = await loadToolsSnapshotsFromBoards(sports);
  const asOfMs = boardAsOfMs(board.snapshots);
  return {
    snapshots: board.snapshots,
    fromBoard: board.sportsHit,
    asOfMs,
  };
}

async function buildOpportunitiesPayload(sports: ToolsSport[]): Promise<OpportunitiesPayload> {
  const { snapshots, fromBoard, asOfMs } = await snapshotsForSports(sports);
  const opportunities = takeBoardOpportunities(scanOpportunities(snapshots));
  return {
    opportunities,
    meta: {
      scannedEvents: snapshots.length,
      scannedAt: new Date(asOfMs || Date.now()).toISOString(),
      sports,
      truncated: false,
      oddsSource: { board: fromBoard, live: [] },
    },
  };
}

async function refreshOpportunities(sports: ToolsSport[], key: string): Promise<OpportunitiesPayload> {
  const existing = refreshInFlight.get(key);
  if (existing) return existing;
  const run = (async () => {
    const payload = await buildOpportunitiesPayload(sports);
    await opportunitiesCacheWrite(key, payload);
    return payload;
  })().finally(() => {
    refreshInFlight.delete(key);
  });
  refreshInFlight.set(key, run);
  return run;
}

export async function runOpportunitiesScan(
  sports: ToolsSport[],
  opts?: { force?: boolean }
): Promise<OpportunitiesPayload> {
  const key = opportunitiesCacheKey(sports);
  if (opts?.force) {
    return refreshOpportunities(sports, key);
  }

  const cached = await opportunitiesCacheRead(key);

  // Instant: memory or Redis still hot — no board load.
  if (cached && cached.ageMs < OPPORTUNITIES_HOT_MS) {
    return cached.payload;
  }

  // Soft: serve immediately, refresh boards in the background.
  if (cached && cached.ageMs < OPPORTUNITIES_SOFT_MS) {
    void refreshOpportunities(sports, key).catch(() => {});
    return cached.payload;
  }

  return refreshOpportunities(sports, key);
}

function mergeSnapshots(board: ToolsSnapshot[], live: ToolsSnapshot[]): ToolsSnapshot[] {
  const byId = new Map<string, ToolsSnapshot>();
  for (const snap of board) byId.set(snap.event.eventId, snap);
  for (const snap of live) {
    const prev = byId.get(snap.event.eventId);
    if (!prev) {
      byId.set(snap.event.eventId, snap);
      continue;
    }
    // Prefer live items when the bonus book is present there.
    byId.set(snap.event.eventId, {
      ...snap,
      items: [...prev.items, ...snap.items],
      asOf: { ...prev.asOf, ...snap.asOf },
    });
  }
  return [...byId.values()];
}

export async function runBonusScan(
  sports: ToolsSport[],
  opts: { bonus: number; bonusBook: string; heldBooks: string[] }
): Promise<BonusPayload> {
  const { snapshots: boardSnaps, fromBoard } = await snapshotsForSports(sports);
  const bonusBook = canonBook(opts.bonusBook);
  const held = [...new Set(opts.heldBooks.map(canonBook).filter((b) => b && b !== bonusBook))];

  const warm = await readBonusLiveBoard();
  const warmOk =
    Boolean(warm?.live.snapshots.length) && warm!.ageMs < BONUS_BOARD_MAX_AGE_MS;

  if (!warmOk) {
    return {
      flips: [],
      meta: {
        scannedEvents: boardSnaps.length,
        scannedAt: new Date().toISOString(),
        sports,
        truncated: false,
        oddsSource: { board: fromBoard, live: [] },
        note: 'Odds board updating — try again in a minute.',
        bonusCoverage: {
          sports: warm?.live.sports ?? [],
          liveEvents: warm?.live.eventsSnapshotted ?? 0,
          listedEvents: warm?.live.eventsListed ?? 0,
          leagues: warm?.live.leaguesTried ?? 0,
          flips: 0,
          bestRetention: null,
          stale: true,
          ageMs: warm?.ageMs,
          warmAt: warm?.at,
        },
      },
    };
  }

  const key = bonusCacheKey(sports, opts.bonus, opts.bonusBook, held, warm!.at);
  const cached = toolsCacheGet<BonusPayload>(key);
  if (cached) return cached;

  let snapshots = boardSnaps;
  if (bonusBook && held.length) {
    snapshots = mergeSnapshots(boardSnaps, warm!.live.snapshots);
  }

  const coverage: NonNullable<BonusPayload['meta']['bonusCoverage']> = {
    sports: warm!.live.sports,
    liveEvents: warm!.live.eventsSnapshotted,
    listedEvents: warm!.live.eventsListed,
    leagues: warm!.live.leaguesTried,
    flips: 0,
    bestRetention: null,
    stale: false,
    ageMs: warm!.ageMs,
    warmAt: warm!.at,
  };

  const flips = scanBonusFlips(snapshots, opts).slice(0, 80);
  coverage.flips = flips.length;
  coverage.bestRetention = flips[0]?.retention ?? null;

  const payload: BonusPayload = {
    flips,
    meta: {
      scannedEvents: snapshots.length,
      scannedAt: new Date(warm!.at).toISOString(),
      sports,
      truncated: coverage.listedEvents > coverage.liveEvents,
      // Warm board is cache — never report a user-facing live odds pull.
      oddsSource: { board: fromBoard, live: [] },
      bonusCoverage: coverage,
    },
  };
  toolsCacheSet(key, payload);
  return payload;
}
