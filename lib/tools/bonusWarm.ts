/**
 * Shared Bonus Flipper live board — warmed every ~15m so Find skips odds-api.net.
 * Pulls all soft books in one sweep (~100–120 credits); Builder (2M) fits easily.
 */

import sharedCache from '@/lib/sharedCache';
import { TOOLS_SOFT_BOOKS } from './books';
import { fetchBonusLiveSnapshots, type BonusLiveResult } from './bonusLive';
import { toolsCacheGetEntry, toolsCacheSet } from './cache';

const MEM_KEY = 'bonus-live-board:v1';
const REDIS_KEY = 'tools:bonus-live-board:v1';
/** Serve without re-pulling. */
export const BONUS_LIVE_HOT_MS = 14 * 60_000;
/** Soft window — still use, cron should have refreshed by then. */
export const BONUS_LIVE_SOFT_MS = 18 * 60_000;
const REDIS_TTL_SEC = 20 * 60;

type Stored = { at: number; live: BonusLiveResult };

/** Coverage seed book — sportsbet lists the widest AU slate. */
const WARM_SEED_BOOK = 'sportsbet';

export async function readWarmBonusLive(): Promise<{ live: BonusLiveResult; ageMs: number } | null> {
  const mem = toolsCacheGetEntry<Stored>(MEM_KEY);
  if (mem?.value?.live) {
    return { live: mem.value.live, ageMs: Date.now() - mem.at };
  }
  try {
    const remote = await sharedCache.getJSON<Stored>(REDIS_KEY);
    if (remote?.live && Number(remote.at) > 0) {
      toolsCacheSet(MEM_KEY, remote, remote.at);
      return { live: remote.live, ageMs: Date.now() - remote.at };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function writeWarmBonusLive(live: BonusLiveResult): Promise<void> {
  const at = Date.now();
  const stored: Stored = { at, live };
  toolsCacheSet(MEM_KEY, stored, at);
  try {
    await sharedCache.setJSON(REDIS_KEY, stored, REDIS_TTL_SEC);
  } catch {
    /* memory still warm on this instance */
  }
}

/** Full soft-book live sweep for the cron / cold Find fallback. */
export async function warmBonusLiveBoard(): Promise<BonusLiveResult> {
  const held = TOOLS_SOFT_BOOKS.filter((b) => b !== WARM_SEED_BOOK);
  const live = await fetchBonusLiveSnapshots({
    bonusBook: WARM_SEED_BOOK,
    heldBooks: [...held],
  });
  if (live.snapshots.length) {
    await writeWarmBonusLive(live);
  }
  return live;
}

/**
 * Prefer warm board; only hit odds-api when cold / expired.
 * `force` always re-pulls (manual Refresh path can pass this later).
 */
export async function getBonusLiveSnapshots(opts: {
  bonusBook: string;
  heldBooks: string[];
  force?: boolean;
}): Promise<BonusLiveResult> {
  if (!opts.force) {
    const warm = await readWarmBonusLive();
    if (warm && warm.ageMs < BONUS_LIVE_SOFT_MS && warm.live.snapshots.length) {
      return warm.live;
    }
  }
  // Targeted pull for this Find (also refreshes the shared warm board).
  const live = await fetchBonusLiveSnapshots(opts);
  if (live.snapshots.length) {
    // Prefer writing the all-books warm when this pull already includes most soft books.
    const heldSet = new Set(opts.heldBooks.map((b) => b.toLowerCase()));
    const softCoverage = TOOLS_SOFT_BOOKS.filter((b) => b !== opts.bonusBook).filter((b) => heldSet.has(b)).length;
    if (softCoverage >= TOOLS_SOFT_BOOKS.length - 4) {
      await writeWarmBonusLive(live);
    }
  }
  return live;
}
