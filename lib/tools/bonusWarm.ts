/**
 * Shared Bonus Flipper odds board — cron writes every ~15m (~100–120 credits);
 * Find only reads Redis/memory (zero odds-api.net).
 */

import sharedCache from '@/lib/sharedCache';
import { TOOLS_SOFT_BOOKS } from './books';
import { fetchBonusLiveSnapshots, type BonusLiveResult } from './bonusLive';
import { toolsCacheGetEntry, toolsCacheSet } from './cache';

const MEM_KEY = 'bonus-live-board:v1';
const REDIS_KEY = 'tools:bonus-live-board:v1';
/** 15m cron + ~1m Vercel skew — Find serves this window only. */
export const BONUS_BOARD_MAX_AGE_MS = 16 * 60_000;
const REDIS_TTL_SEC = 20 * 60;

type Stored = { at: number; live: BonusLiveResult };

/** Coverage seed book — sportsbet lists the widest AU slate. */
const WARM_SEED_BOOK = 'sportsbet';

/** Redis/memory read — never calls odds-api.net. */
export async function readBonusLiveBoard(): Promise<{ live: BonusLiveResult; ageMs: number; at: number } | null> {
  const mem = toolsCacheGetEntry<Stored>(MEM_KEY);
  if (mem?.value?.live) {
    return { live: mem.value.live, ageMs: Date.now() - mem.at, at: mem.at };
  }
  try {
    const remote = await sharedCache.getJSON<Stored>(REDIS_KEY);
    if (remote?.live && Number(remote.at) > 0) {
      toolsCacheSet(MEM_KEY, remote, remote.at);
      return { live: remote.live, ageMs: Date.now() - remote.at, at: remote.at };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** @deprecated Use readBonusLiveBoard — same cache-only read. */
export async function readWarmBonusLive(): Promise<{ live: BonusLiveResult; ageMs: number } | null> {
  const warm = await readBonusLiveBoard();
  return warm ? { live: warm.live, ageMs: warm.ageMs } : null;
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

/** Sole odds-api.net writer — cron only. */
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
