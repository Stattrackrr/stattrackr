/**
 * Cash top8 arm, one scan: NBA board → market-EV ≥ 3% → live reprice → fill remaining ET-day
 * top-8 slots → admin-only post. No member push; no LLM review (the edge is the price).
 */

import { alternateBooks } from '@/lib/aiPicks/books';
import type { CandidateScan } from '@/lib/aiPicks/candidates';
import { fetchLiveNbaGames, repriceNbaCandidate, type NbaLiveGame } from '@/lib/aiPicks/candidates/nbaLive';
import type { AiCandidate } from '@/lib/aiPicks/candidates/types';
import { sportParams } from '@/lib/aiPicks/decide/select';
import { pickTitle } from '@/lib/aiPicks/format';
import { round } from '@/lib/aiPicks/model/math';
import { AI_CASH_POLICY, AI_CASH_TRACK, trackWatchKey, type AiPicksParams } from '@/lib/aiPicks/params';
import { claimTrackWatch, insertPick, listTrackPicksPostedSince, listTrackWatchRows, releaseWatch, type TrackWatchMeta } from '@/lib/aiPicks/server';
import {
  cashCandidate,
  cashEligible,
  cashMarketEv,
  cashProposal,
  cashPostedState,
  cashWriteUp,
  chooseCash,
  CASH_LIMITS,
} from './decide';

const RECENT_PICKS_MS = 48 * 60 * 60 * 1000;
const LIVE_PRICE_ROUNDS = 2;

export type CashRunSummary = {
  board: number;
  eligible: number;
  dayCount: number;
  dayRoom: number;
  proposals: Array<{ title: string; price: number; marketEv: number }>;
  posted: Array<{ id: string; title: string }>;
  skipped: string[];
  livePriceRequests: number;
  errors: string[];
};

function watchMeta(c: AiCandidate): TrackWatchMeta {
  return {
    sport: c.sport,
    event_key: c.eventKey,
    starts_at: c.startsAt,
    market: c.market,
    player: c.player,
    side: c.side,
    line: c.line,
    best_price: c.bestPrice,
    bookmaker: c.bestBook,
  };
}

export function cashEntries(scan: CandidateScan): AiCandidate[] {
  return scan.candidates.flatMap((raw) => {
    if (raw.sport !== 'nba') return [];
    const c = cashCandidate(raw);
    return c ? [c] : [];
  });
}

async function chooseAtLivePrices(
  entries: AiCandidate[],
  state: ReturnType<typeof cashPostedState>,
  closed: Set<string>,
  params: AiPicksParams,
  nowMs: number,
  liveGames: Map<string, NbaLiveGame>,
  summary: CashRunSummary
): Promise<AiCandidate[]> {
  const nba = sportParams(params, 'nba');
  const repriced = new Set<string>();
  const failed = new Set<string>();
  let list = entries;
  const reprice = () => {
    list = list.flatMap((c) => {
      const game = liveGames.get(c.eventKey);
      if (!game || repriced.has(c.key)) return [c];
      repriced.add(c.key);
      const next = repriceNbaCandidate(c, game, nba, nowMs);
      const priced = next ? cashCandidate(next) : null;
      return priced ? [priced] : [];
    });
  };
  for (let pass = 0; ; pass += 1) {
    reprice();
    const chosen = chooseCash(
      list.filter((c) => !failed.has(c.eventKey)),
      state,
      nowMs,
      closed
    );
    const need = new Map(chosen.filter((c) => !liveGames.has(c.eventKey)).map((c) => [c.eventKey, c]));
    if (!need.size) return chosen;
    if (pass >= LIVE_PRICE_ROUNDS) return chosen.filter((c) => liveGames.has(c.eventKey));
    try {
      const res = await Promise.race([
        fetchLiveNbaGames(
          [...need.values()].map((c) => {
            const [awayTeam = '', homeTeam = ''] = c.eventLabel.split(' @ ');
            return { gameId: c.eventKey, homeTeam, awayTeam, startsAt: c.startsAt };
          })
        ),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('live price pull timed out')), 25_000)),
      ]);
      summary.livePriceRequests += res.requests;
      for (const [id, game] of res.live) liveGames.set(id, game);
    } catch (e) {
      summary.errors.push(`live prices: ${(e as Error).message}`);
      // Don't block the whole day on a hung odds pull — skip those games this scan.
      for (const id of need.keys()) failed.add(id);
      continue;
    }
    for (const id of need.keys()) if (!liveGames.has(id)) failed.add(id);
  }
}

async function post(c: AiCandidate, scannedAt: string): Promise<string | null> {
  const p = cashProposal(c);
  if (!(await claimTrackWatch(AI_CASH_TRACK, AI_CASH_POLICY, c.key, watchMeta(c)))) return null;
  try {
    return await insertPick(
      {
        kind: 'single',
        sport: c.sport,
        title: pickTitle([c]),
        write_up: cashWriteUp(c),
        units: CASH_LIMITS.units,
        price: round(p.price, 3),
        bookmaker: p.book,
        model_prob: round(c.prob, 4),
        ev: round(c.ev, 4),
        first_starts_at: c.startsAt,
        model_version: AI_CASH_TRACK,
        track: AI_CASH_TRACK,
        context: {
          scannedAt,
          whyNow: p.reason,
          review: 'cash-v1: no LLM review — edge is market EV vs soft AU price',
          staking: `Flat ${CASH_LIMITS.units} unit (admin cash arm)`,
          policy_version: AI_CASH_POLICY,
          altBooks: alternateBooks([c.quotes], p.book),
          cash: { limits: CASH_LIMITS, marketEv: cashMarketEv(c) },
          legs: [
            {
              key: c.key,
              prob: c.prob,
              marketProb: c.marketProb,
              pushProb: c.pushProb,
              ev: c.ev,
              bestPrice: c.bestPrice,
              bestBook: c.bestBook,
              quotes: c.quotes.slice(0, 10),
              flags: c.flags,
              liveModel: { modelProb: c.modelProb, projection: c.projection },
              context: c.context,
            },
          ],
        },
      },
      [
        {
          leg_index: 0,
          sport: c.sport,
          event_key: c.eventKey,
          event_label: c.eventLabel,
          starts_at: c.startsAt,
          market: c.market,
          market_kind: c.marketKind,
          player: c.player,
          player_id: c.playerId,
          team: c.team,
          side: c.side,
          line: c.line,
          price: p.price,
          bookmaker: p.book,
          model_prob: round(c.prob, 4),
        },
      ]
    );
  } catch (err) {
    await releaseWatch(trackWatchKey(AI_CASH_TRACK, c.key));
    throw err;
  }
}

export async function runCashArm(input: {
  scan: CandidateScan;
  params: AiPicksParams;
  nowMs: number;
  fresh: boolean;
  liveGames?: Map<string, NbaLiveGame>;
}): Promise<CashRunSummary> {
  const { scan, params, nowMs } = input;
  const summary: CashRunSummary = {
    board: 0,
    eligible: 0,
    dayCount: 0,
    dayRoom: CASH_LIMITS.perDay,
    proposals: [],
    posted: [],
    skipped: [],
    livePriceRequests: 0,
    errors: [],
  };
  const entries = cashEntries(scan);
  summary.board = entries.length;
  const eligible = entries.filter((c) => cashEligible(c, nowMs).ok);
  summary.eligible = eligible.length;
  if (!eligible.length) return summary;
  if (!input.fresh) {
    summary.skipped.push('NBA odds or injury report are stale');
    return summary;
  }

  let state: ReturnType<typeof cashPostedState>;
  try {
    state = cashPostedState(await listTrackPicksPostedSince(AI_CASH_TRACK, new Date(nowMs - RECENT_PICKS_MS).toISOString()), nowMs);
  } catch (e) {
    summary.skipped.push(`Not posting until migrations/ai_picks_track.sql is run (${(e as Error).message})`);
    return summary;
  }
  summary.dayCount = state.dayCount;
  summary.dayRoom = Math.max(0, CASH_LIMITS.perDay - state.dayCount);
  if (!summary.dayRoom) {
    summary.skipped.push(`Cash day full (${CASH_LIMITS.perDay} already posted ${state.dayKey})`);
    return summary;
  }

  const prefix = trackWatchKey(AI_CASH_TRACK, '');
  const closed = new Set(
    (await listTrackWatchRows(AI_CASH_TRACK, eligible.map((c) => c.key)))
      .filter((r) => r.status === 'posted')
      .map((r) => r.candidate_key.slice(prefix.length))
  );

  const chosen = await chooseAtLivePrices(eligible, state, closed, params, nowMs, input.liveGames ?? new Map(), summary);
  if (!chosen.length) return summary;
  summary.proposals = chosen.map((c) => ({
    title: pickTitle([c]),
    price: c.bestPrice,
    marketEv: c.ev,
  }));

  for (const c of chosen) {
    const title = pickTitle([c]);
    try {
      const id = await post(c, scan.scannedAt);
      if (id) {
        summary.posted.push({ id, title });
        state.dayCount += 1;
        state.keys.add(c.key);
        if (c.player) state.players.add(c.player.toLowerCase());
      } else summary.skipped.push(`${title}: already posted or claimed`);
    } catch (err) {
      summary.errors.push(`post ${title}: ${(err as Error).message}`);
    }
  }
  return summary;
}
