import type { AiCandidate } from '@/lib/aiPicks/candidates/types';
import { candidateKey } from '@/lib/aiPicks/candidates/types';
import { round } from '@/lib/aiPicks/model/math';
import type { WatchRow } from '@/lib/aiPicks/server';
import type { AiPick } from '@/lib/aiPicks/types';
import { aiDayKey, gameIdentity, type WatchPoint } from '@/lib/aiPicks/decide/timing';
import { selectionId, subjectId, type PostedState } from '@/lib/aiPicks/decide/select';

const MAX_HISTORY = 24;
export const REVIEW_REJECTED = 'AI review:';

export function parseHistory(raw: unknown): WatchPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is WatchPoint => p && typeof p.at === 'string' && Number.isFinite(p.price) && Number.isFinite(p.prob) && Number.isFinite(p.ev)
  );
}

/**
 * A bulk upsert sends every column any row has, and rows missing one get NULL (which would wipe
 * first_seen_at on existing rows and break its NOT NULL). Rows are grouped by their exact columns.
 */
export function watchBatches(rows: WatchRow[], size = 200): WatchRow[][] {
  const groups = new Map<string, WatchRow[]>();
  for (const row of rows) {
    const shape = Object.keys(row).sort().join(',');
    groups.set(shape, [...(groups.get(shape) ?? []), row]);
  }
  const out: WatchRow[][] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += size) out.push(group.slice(i, i + size));
  }
  return out;
}

/** Rows the AI will never post again: already posted, or turned down on review. */
export function isClosedRow(row: Pick<WatchRow, 'status' | 'reason'> | undefined): boolean {
  if (!row) return false;
  return row.status === 'posted' || (row.status === 'dropped' && String(row.reason ?? '').startsWith(REVIEW_REJECTED));
}

/** Watchlist row after this scan, or null to leave a closed row untouched. */
export function nextWatchRow(c: AiCandidate, existing: WatchRow | undefined, nowIso: string): { row: WatchRow; history: WatchPoint[] } | null {
  if (isClosedRow(existing)) return null;
  const history = [...parseHistory(existing?.history), { at: nowIso, price: c.bestPrice, prob: round(c.prob, 4), ev: round(c.ev, 4) }].slice(
    -MAX_HISTORY
  );
  return {
    history,
    row: {
      candidate_key: c.key,
      sport: c.sport,
      event_key: c.eventKey,
      starts_at: c.startsAt,
      market: c.market,
      player: c.player,
      side: c.side,
      line: c.line,
      best_price: c.bestPrice,
      bookmaker: c.bestBook,
      model_prob: round(c.prob, 4),
      ev: round(c.ev, 4),
      score: c.supportScore,
      status: 'watching',
      reason: null,
      history,
      ...(existing ? {} : {       first_seen_at: nowIso }),
      last_seen_at: nowIso,
      event_label: c.eventLabel,
      market_kind: c.marketKind,
      player_id: c.playerId,
      team: c.team,
      raw_model_prob: c.modelProb == null ? null : round(c.modelProb, 4),
      market_prob: c.marketProb == null ? null : round(c.marketProb, 4),
      push_prob: round(c.pushProb, 4),
      base_model_prob: c.contextProbs ? round(c.contextProbs.base, 4) : null,
      full_model_prob: c.contextProbs ? round(c.contextProbs.full, 4) : null,
    },
  };
}

export function postedState(picks: AiPick[], nowMs: number): PostedState {
  const today = aiDayKey(nowMs);
  const state: PostedState = {
    singlesToday: {},
    multisToday: 0,
    usedKeys: new Set(),
    singleGamesToday: new Set(),
    playersToday: new Set(),
    selectionsBacked: new Set(),
    subjectsUsed: new Set(),
  };
  for (const pick of picks) {
    const isToday = aiDayKey(pick.postedAt) === today;
    if (isToday && pick.kind === 'multi') state.multisToday += 1;
    if (isToday && pick.kind === 'single') state.singlesToday[pick.sport] = (state.singlesToday[pick.sport] ?? 0) + 1;
    for (const leg of pick.legs) {
      state.usedKeys.add(candidateKey(leg));
      state.subjectsUsed.add(subjectId(leg));
      if (leg.status === 'pending') state.selectionsBacked.add(selectionId(leg));
      if (isToday && pick.kind === 'single') {
        state.singleGamesToday.add(gameIdentity(leg));
        if (leg.player) state.playersToday.add(`${leg.sport}|${leg.player.toLowerCase()}`);
      }
    }
  }
  return state;
}
