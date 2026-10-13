/**
 * When to post. A play goes on the watchlist the first time it qualifies and is only posted after it
 * holds up on a later scan, and then only when the game is close, the price starts shortening, or
 * the edge is strong and steady. Waiting lets lines and team news settle; the triggers stop the
 * value disappearing while it waits.
 */

import { nblTeamKey } from '@/lib/aiPicks/model/nblGames';

export const AI_PICKS_TZ = 'Australia/Sydney';
/** Nothing is posted closer to the start than this. */
export const MIN_LEAD_MS = 20 * 60 * 1000;
/** Scans run every 15 minutes; a gap longer than this means the play dropped out in between. */
const CONSECUTIVE_SCAN_MS = 50 * 60 * 1000;
/** Best price this far below the first sighting means the market is moving onto the play. */
const SHORTENING = 0.97;
const STRONG_EV_MULTIPLE = 2;
const STRONG_SCANS = 3;

export type WatchPoint = { at: string; price: number; prob: number; ev: number };

export function aiDayKey(iso: string | number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: AI_PICKS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso)
  );
}

/** Same real-world game across sources: NBL props and game lines name teams slightly differently. */
export function gameIdentity(c: { sport: string; eventKey: string; eventLabel: string; startsAt: string }): string {
  if (c.sport !== 'nbl') return `${c.sport}|${c.eventKey}`;
  const teams = c.eventLabel.split(' @ ').map((t) => nblTeamKey(t.trim())).sort();
  return `nbl|${aiDayKey(c.startsAt)}|${teams.join('|')}`;
}

export type Readiness = { ready: boolean; reason: string };

/** Qualified on this scan and the one before. */
export function heldUp(history: WatchPoint[], nowMs: number): boolean {
  const prev = history.at(-2);
  return Boolean(prev && nowMs - Date.parse(prev.at) <= CONSECUTIVE_SCAN_MS);
}

/**
 * `history` ends with the current scan. Every point in it qualified (rows that drop out are not
 * extended), so the checks only need timing and price.
 */
export function readiness(
  c: { startsAt: string; ev: number; bestPrice: number },
  history: WatchPoint[],
  opts: { nowMs: number; postWindowHours: number; minEv: number }
): Readiness {
  const toStart = Date.parse(c.startsAt) - opts.nowMs;
  if (!(toStart > MIN_LEAD_MS)) return { ready: false, reason: 'Too close to the start' };
  if (!heldUp(history, opts.nowMs)) return { ready: false, reason: 'Waiting for a second look' };
  if (toStart <= opts.postWindowHours * 3_600_000) return { ready: true, reason: 'Game is close and the play is holding' };
  if (c.bestPrice <= history[0]!.price * SHORTENING) return { ready: true, reason: 'Price is shortening, taking it before it goes' };
  const recent = history.slice(-STRONG_SCANS);
  if (recent.length >= STRONG_SCANS && recent.every((p) => p.ev >= opts.minEv * STRONG_EV_MULTIPLE)) {
    return { ready: true, reason: 'Strong edge holding across scans' };
  }
  return { ready: false, reason: 'Watching for a better moment' };
}
