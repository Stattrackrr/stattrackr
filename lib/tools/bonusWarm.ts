/**
 * Shared Bonus Flipper odds board — cron writes every ~15m (~100–120 credits);
 * Find only reads Redis/memory (zero odds-api.net).
 */

import { gzipSync } from 'zlib';
import sharedCache from '@/lib/sharedCache';
import { TOOLS_SOFT_BOOKS } from './books';
import { fetchBonusLiveSnapshots, type BonusLiveResult } from './bonusLive';
import type { ToolsSnapshot } from './fetch';
import { toolsCacheGetEntry, toolsCacheSet } from './cache';

const MEM_KEY = 'bonus-live-board:v1';
const REDIS_KEY = 'tools:bonus-live-board:v1';
/** 15m cron + ~1m Vercel skew — Find serves this window only. */
export const BONUS_BOARD_MAX_AGE_MS = 16 * 60_000;
const REDIS_TTL_SEC = 20 * 60;
/** Stay under Upstash's 8MB request cap (gzip JSON body). */
const REDIS_SAFE_MAX_BYTES = 7.5 * 1024 * 1024;

type Stored = { at: number; live: BonusLiveResult };

/** Coverage seed book — sportsbet lists the widest AU slate. */
const WARM_SEED_BOOK = 'sportsbet';

/** Packed size as sharedCache would send to Upstash. */
export function bonusBoardRedisBytes(live: BonusLiveResult, at = Date.now()): number {
  const json = JSON.stringify({ at, live } satisfies Stored);
  const packed = JSON.stringify({
    v: 1,
    encoding: 'gzip-json',
    payload: gzipSync(Buffer.from(json), { level: 6 }).toString('base64'),
  });
  return Math.min(json.length, packed.length);
}

/** Drop player props and unused item fields so the board fits in Redis. */
export function slimBonusLive(live: BonusLiveResult): BonusLiveResult {
  const snapshots: ToolsSnapshot[] = live.snapshots.map((s) => ({
    event: s.event,
    asOf: s.asOf,
    items: s.items
      .filter((it) => String(it.bet_type || '').toLowerCase() !== 'player prop')
      .map((it) => ({
        bookmaker: it.bookmaker,
        bet_type: it.bet_type,
        metric: it.metric,
        period: it.period,
        side: it.side,
        line: it.line,
        odds: it.odds,
        is_available: it.is_available,
      })),
  }));
  return {
    ...live,
    snapshots,
    eventsSnapshotted: snapshots.length,
  };
}

function trimToRedisLimit(live: BonusLiveResult): { live: BonusLiveResult; bytes: number } {
  let next = slimBonusLive(live);
  let bytes = bonusBoardRedisBytes(next);
  while (bytes > REDIS_SAFE_MAX_BYTES && next.snapshots.length > 8) {
    const keep = Math.max(8, Math.floor(next.snapshots.length * 0.7));
    next = {
      ...next,
      snapshots: next.snapshots.slice(0, keep),
      eventsSnapshotted: keep,
    };
    bytes = bonusBoardRedisBytes(next);
  }
  return { live: next, bytes };
}

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

export type BonusWarmWriteResult = { persisted: boolean; bytes: number; events: number; at: number };

export async function writeWarmBonusLive(live: BonusLiveResult): Promise<BonusWarmWriteResult> {
  const trimmed = trimToRedisLimit(live);
  const at = Date.now();
  const stored: Stored = { at, live: trimmed.live };
  toolsCacheSet(MEM_KEY, stored, at);
  if (trimmed.bytes > REDIS_SAFE_MAX_BYTES) {
    console.warn(`[bonusWarm] board ${trimmed.bytes} bytes still over Redis cap; Find may stay stale`);
  }
  try {
    // skipMemory: Redis miss must not be masked by process memory when we verify.
    await sharedCache.setJSON(REDIS_KEY, stored, REDIS_TTL_SEC, { skipMemory: true });
    const [remote] = await sharedCache.getJSONMany<Stored>([REDIS_KEY]);
    const persisted = Boolean(remote && remote.at === at);
    if (!persisted) {
      console.warn(`[bonusWarm] Redis SET did not stick (${trimmed.bytes} bytes, ${trimmed.live.snapshots.length} events)`);
    }
    return { persisted, bytes: trimmed.bytes, events: trimmed.live.snapshots.length, at };
  } catch (err) {
    console.warn('[bonusWarm] Redis write failed', err instanceof Error ? err.message : err);
    return { persisted: false, bytes: trimmed.bytes, events: trimmed.live.snapshots.length, at };
  }
}

export type BonusWarmResult = BonusLiveResult & { persisted: boolean; redisBytes: number };

/** Sole odds-api.net writer — cron only. */
export async function warmBonusLiveBoard(): Promise<BonusWarmResult> {
  const held = TOOLS_SOFT_BOOKS.filter((b) => b !== WARM_SEED_BOOK);
  const live = await fetchBonusLiveSnapshots({
    bonusBook: WARM_SEED_BOOK,
    heldBooks: [...held],
  });
  if (!live.snapshots.length) {
    return { ...live, persisted: false, redisBytes: 0 };
  }
  const write = await writeWarmBonusLive(live);
  const stored = toolsCacheGetEntry<Stored>(MEM_KEY)?.value?.live;
  const out = stored ?? slimBonusLive(live);
  return { ...out, persisted: write.persisted, redisBytes: write.bytes };
}
