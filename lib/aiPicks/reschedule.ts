/**
 * Matches get moved (rain, a late finish on court, a rescheduled game) after a pick is posted. Each
 * scan checks pending legs against the current fixture times and moves any leg whose match moved, so
 * the card shows the real start, closing prices are taken before the real start, and grading waits.
 */

import { nblTeamKey } from '@/lib/aiPicks/model/nblGames';
import type { AiPick, AiPickLeg } from '@/lib/aiPicks/types';

export type FixtureTimes = {
  /** Tennis match id (the leg's event key) to its current start. */
  tennis: Map<string, string>;
  nbl: Array<{ homeTeam: string; awayTeam: string; startsAt: string }>;
  /** NBA game id (the leg's event key) to its current tip-off. */
  nba?: Map<string, string>;
};

/** Smaller differences are feed rounding, not a move. */
const MIN_SHIFT_MS = 5 * 60 * 1000;
/** An NBL game moved further than this is treated as a different game between the same teams. */
const NBL_MOVE_MS = 48 * 60 * 60 * 1000;

const pairKey = (a: string, b: string) => [nblTeamKey(a), nblTeamKey(b)].sort().join('|');

/** The leg's new start, or null when it has not moved (or its match is not in the fixtures). */
export function rescheduledStart(leg: Pick<AiPickLeg, 'sport' | 'eventKey' | 'eventLabel' | 'startsAt'>, times: FixtureTimes): string | null {
  const was = Date.parse(leg.startsAt);
  if (!Number.isFinite(was)) return null;
  let now: number | null = null;
  if (leg.sport === 'tennis' || leg.sport === 'nba') {
    const t = Date.parse((leg.sport === 'tennis' ? times.tennis : times.nba)?.get(leg.eventKey) ?? '');
    now = Number.isFinite(t) ? t : null;
  } else if (leg.sport === 'nbl') {
    const [away, home] = leg.eventLabel.split(' @ ');
    if (!away || !home) return null;
    const key = pairKey(home, away);
    let best: number | null = null;
    for (const g of times.nbl) {
      const t = Date.parse(g.startsAt);
      if (!Number.isFinite(t) || pairKey(g.homeTeam, g.awayTeam) !== key || Math.abs(t - was) > NBL_MOVE_MS) continue;
      if (best == null || Math.abs(t - was) < Math.abs(best - was)) best = t;
    }
    now = best;
  }
  if (now == null || Math.abs(now - was) < MIN_SHIFT_MS) return null;
  return new Date(now).toISOString();
}

export type PickReschedule = { pickId: string; legs: Array<{ id: string; from: string; to: string }>; firstStartsAt: string };

/** Pending legs whose match moved, grouped by pick with the pick's new first start. */
export function reschedules(picks: AiPick[], times: FixtureTimes): PickReschedule[] {
  const out: PickReschedule[] = [];
  for (const pick of picks) {
    const moved: PickReschedule['legs'] = [];
    const starts: string[] = [];
    for (const leg of pick.legs) {
      const to = leg.status === 'pending' ? rescheduledStart(leg, times) : null;
      if (to) moved.push({ id: leg.id, from: leg.startsAt, to });
      starts.push(to ?? leg.startsAt);
    }
    if (moved.length) out.push({ pickId: pick.id, legs: moved, firstStartsAt: starts.sort()[0]! });
  }
  return out;
}
