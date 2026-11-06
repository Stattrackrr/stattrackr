/**
 * Orchestrates tools scans from cron-backed Redis boards (ARB/EV/MID).
 * Bonus Flipper may add a capped all-sports live pull (odds-api.net credits).
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
import { getBonusLiveSnapshots } from './bonusWarm';
import { canonBook } from './books';
import type { ToolsSnapshot } from './fetch';
import { loadToolsSnapshotsFromBoards } from './fromBoard';
import { scanBonusFlips, scanOpportunities } from './scan';
import type { ToolsSport } from './types';

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
  const opportunities = scanOpportunities(snapshots).slice(0, 100);
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
  const key = bonusCacheKey(sports, opts.bonus, opts.bonusBook, opts.heldBooks);
  const cached = toolsCacheGet<BonusPayload>(key);
  // Wall TTL (~15m) — reuse live sweeps so repeat clicks don't re-burn credits.
  if (cached) return cached;

  const bonusBook = canonBook(opts.bonusBook);
  const held = [...new Set(opts.heldBooks.map(canonBook).filter((b) => b && b !== bonusBook))];
  let snapshots = boardSnaps;
  let usedLive = false;
  let coverage: BonusPayload['meta']['bonusCoverage'];

  if (bonusBook && held.length) {
    try {
      // Prefer the 15m warm board (all soft books); cold path still pulls live.
      const live = await getBonusLiveSnapshots({ bonusBook, heldBooks: held });
      if (live.snapshots.length) {
        snapshots = mergeSnapshots(boardSnaps, live.snapshots);
        usedLive = true;
      }
      coverage = {
        sports: live.sports,
        liveEvents: live.eventsSnapshotted,
        listedEvents: live.eventsListed,
        leagues: live.leaguesTried,
        flips: 0,
        bestRetention: null,
      };
    } catch (err) {
      console.error('[tools/bonus] live sweep failed', err);
    }
  }

  const flips = scanBonusFlips(snapshots, opts).slice(0, 80);
  if (coverage) {
    coverage.flips = flips.length;
    coverage.bestRetention = flips[0]?.retention ?? null;
  }

  const payload: BonusPayload = {
    flips,
    meta: {
      scannedEvents: snapshots.length,
      scannedAt: new Date().toISOString(),
      sports,
      truncated: Boolean(coverage && coverage.listedEvents > coverage.liveEvents),
      oddsSource: { board: fromBoard, live: usedLive ? fromBoard : [] },
      bonusCoverage: coverage,
    },
  };
  toolsCacheSet(key, payload);
  return payload;
}
