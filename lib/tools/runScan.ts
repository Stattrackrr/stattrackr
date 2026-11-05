/**
 * Orchestrates tools scans from cron-backed Redis boards (ARB/EV/MID).
 * Bonus Flipper may add a capped all-sports live pull (odds-api.net credits).
 */

import {
  bonusCacheKey,
  opportunitiesCacheKey,
  toolsCacheGet,
  toolsCacheSet,
  type BonusPayload,
  type OpportunitiesPayload,
} from './cache';
import { fetchBonusLiveSnapshots } from './bonusLive';
import { canonBook } from './books';
import type { ToolsSnapshot } from './fetch';
import { loadToolsSnapshotsFromBoards } from './fromBoard';
import { scanBonusFlips, scanOpportunities } from './scan';
import type { ToolsSport } from './types';

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

export async function runOpportunitiesScan(sports: ToolsSport[]): Promise<OpportunitiesPayload> {
  const { snapshots, fromBoard, asOfMs } = await snapshotsForSports(sports);
  const key = opportunitiesCacheKey(sports);
  const cached = toolsCacheGet<OpportunitiesPayload>(key);
  // Keep serving the last scan until the underlying boards move.
  if (cached && asOfMs > 0 && Date.parse(cached.meta.scannedAt) >= asOfMs) {
    return cached;
  }

  const opportunities = scanOpportunities(snapshots);
  const payload: OpportunitiesPayload = {
    opportunities,
    meta: {
      scannedEvents: snapshots.length,
      scannedAt: new Date(asOfMs || Date.now()).toISOString(),
      sports,
      truncated: false,
      oddsSource: { board: fromBoard, live: [] },
    },
  };
  toolsCacheSet(key, payload);
  return payload;
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
      const live = await fetchBonusLiveSnapshots({ bonusBook, heldBooks: held });
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
