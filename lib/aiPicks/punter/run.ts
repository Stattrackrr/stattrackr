/**
 * Punter arm, one scan: the cases the scan found (reasons) -> price discipline and limits -> a fresh
 * price pull -> the data veto and write-up -> an admin-only post. It reads only its own picks and
 * watch rows, never sends an alert, and every failure stays inside its own summary.
 */

import { alternateBooks } from '@/lib/aiPicks/books';
import type { CandidateScan } from '@/lib/aiPicks/candidates';
import { fetchLiveNbaGames, repriceNbaCandidate, type NbaLiveGame } from '@/lib/aiPicks/candidates/nbaLive';
import { reviewPunterPlays, type PunterPlay } from '@/lib/aiPicks/decide/review';
import { sportParams } from '@/lib/aiPicks/decide/select';
import { pickTitle } from '@/lib/aiPicks/format';
import { round } from '@/lib/aiPicks/model/math';
import { AI_PUNTER_POLICY, AI_PUNTER_TRACK, trackWatchKey, type AiPicksParams } from '@/lib/aiPicks/params';
import {
  claimTrackWatch,
  insertPick,
  listTrackPicksPostedSince,
  listTrackWatchRows,
  rejectTrackWatch,
  releaseWatch,
  type TrackWatchMeta,
} from '@/lib/aiPicks/server';
import { PUNTER_RULES } from './angles';
import { gameIdentity } from '@/lib/aiPicks/decide/timing';
import { choosePunter, punterCandidate, punterEligible, punterPostedState, punterProposal, PUNTER_LIMITS, type PunterEntry } from './decide';

/** Kept apart from the live review's prefix, so the arm's vetoes never use the live review budget. */
export const PUNTER_REVIEW_REJECTED = 'Punter review:';
const RECENT_PICKS_MS = 48 * 60 * 60 * 1000;
/** Fresh price pulls per scan: the chosen games, then once more if a moved price changes the choice. */
const LIVE_PRICE_ROUNDS = 2;

export type PunterRunSummary = {
  /** Selections on the board whose reasons qualify. */
  cases: number;
  /** Of those, inside the posting window and the price rules. */
  eligible: number;
  proposals: Array<{ title: string; price: number; marketEv: number; reasons: string[] }>;
  posted: Array<{ id: string; title: string }>;
  rejected: Array<{ title: string; reason: string }>;
  skipped: string[];
  livePriceRequests: number;
  review: { model: string | null; tokensIn: number; tokensOut: number; error: string | null } | null;
  errors: string[];
};

function watchMeta(e: PunterEntry): TrackWatchMeta {
  const c = e.c;
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

/** The scan's qualifying cases as this arm prices them (the market's fair chance, not the live model's). */
export function punterEntries(scan: CandidateScan): PunterEntry[] {
  const cases = scan.nba?.punterCases;
  if (!cases?.size) return [];
  return scan.candidates.flatMap((raw) => {
    const found = raw.sport === 'nba' ? cases.get(raw.key) : undefined;
    const c = found ? punterCandidate(raw) : null;
    return found && c ? [{ c, case: found }] : [];
  });
}

/**
 * The choice at live prices. Games already pulled this scan are reused; the chosen plays' other
 * games are pulled fresh, and a play whose game could not be pulled is left for the next scan.
 */
async function chooseAtLivePrices(
  entries: PunterEntry[],
  state: ReturnType<typeof punterPostedState>,
  closed: Set<string>,
  params: AiPicksParams,
  nowMs: number,
  liveGames: Map<string, NbaLiveGame>,
  summary: PunterRunSummary
): Promise<PunterEntry[]> {
  const nba = sportParams(params, 'nba');
  const repriced = new Set<string>();
  const failed = new Set<string>();
  let list = entries;
  const reprice = () => {
    list = list.flatMap((e) => {
      const game = liveGames.get(e.c.eventKey);
      if (!game || repriced.has(e.c.key)) return [e];
      repriced.add(e.c.key);
      const next = repriceNbaCandidate(e.c, game, nba, nowMs);
      const c = next ? punterCandidate(next) : null;
      return c ? [{ ...e, c }] : [];
    });
  };
  for (let pass = 0; ; pass += 1) {
    reprice();
    const chosen = choosePunter(list.filter((e) => !failed.has(e.c.eventKey)), state, nowMs, closed);
    const need = new Map(chosen.filter((e) => !liveGames.has(e.c.eventKey)).map((e) => [e.c.eventKey, e.c]));
    if (!need.size) return chosen;
    if (pass >= LIVE_PRICE_ROUNDS) return chosen.filter((e) => liveGames.has(e.c.eventKey));
    try {
      const res = await fetchLiveNbaGames(
        [...need.values()].map((c) => {
          const [awayTeam = '', homeTeam = ''] = c.eventLabel.split(' @ ');
          return { gameId: c.eventKey, homeTeam, awayTeam, startsAt: c.startsAt };
        })
      );
      summary.livePriceRequests += res.requests;
      for (const [id, game] of res.live) liveGames.set(id, game);
    } catch (e) {
      summary.errors.push(`live prices: ${(e as Error).message}`);
    }
    // Board prices are never posted: a game the pull missed sits this scan out.
    for (const id of need.keys()) if (!liveGames.has(id)) failed.add(id);
  }
}

async function post(e: PunterEntry, play: PunterPlay, writeUp: string, review: string, scannedAt: string): Promise<string | null> {
  const c = e.c;
  const p = play.proposal;
  if (!(await claimTrackWatch(AI_PUNTER_TRACK, AI_PUNTER_POLICY, c.key, watchMeta(e)))) return null;
  try {
    return await insertPick(
      {
        kind: 'single',
        sport: c.sport,
        title: pickTitle([c]),
        write_up: writeUp,
        units: PUNTER_LIMITS.units,
        price: round(p.price, 3),
        bookmaker: p.book,
        model_prob: round(c.prob, 4),
        ev: round(c.ev, 4),
        first_starts_at: c.startsAt,
        model_version: AI_PUNTER_TRACK,
        track: AI_PUNTER_TRACK,
        context: {
          scannedAt,
          whyNow: p.reason,
          review,
          staking: `Flat ${PUNTER_LIMITS.units} unit (test arm)`,
          policy_version: AI_PUNTER_POLICY,
          altBooks: alternateBooks([c.quotes], p.book),
          punter: { case: e.case, rules: PUNTER_RULES, limits: PUNTER_LIMITS },
          legs: [
            {
              key: c.key,
              // This arm's numbers: the market's fair chance and the price against it.
              prob: c.prob,
              marketProb: c.marketProb,
              pushProb: c.pushProb,
              ev: c.ev,
              bestPrice: c.bestPrice,
              bestBook: c.bestBook,
              quotes: c.quotes.slice(0, 10),
              flags: c.flags,
              // What the live model made of the same line, for comparing the two later.
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
    await releaseWatch(trackWatchKey(AI_PUNTER_TRACK, c.key));
    throw err;
  }
}

export async function runPunterArm(input: {
  scan: CandidateScan;
  params: AiPicksParams;
  nowMs: number;
  /** The NBA board, AU prices and injury report are fresh enough to post from (the live picks' test). */
  fresh: boolean;
  /** Fresh pulls already made this scan, by game id; reused and added to. */
  liveGames?: Map<string, NbaLiveGame>;
}): Promise<PunterRunSummary> {
  const { scan, params, nowMs } = input;
  const summary: PunterRunSummary = { cases: 0, eligible: 0, proposals: [], posted: [], rejected: [], skipped: [], livePriceRequests: 0, review: null, errors: [] };
  const entries = punterEntries(scan);
  summary.cases = entries.length;
  const eligible = entries.filter((e) => punterEligible(e.c, nowMs).ok);
  summary.eligible = eligible.length;
  if (!eligible.length) return summary;
  if (!input.fresh) {
    summary.skipped.push('NBA odds or injury report are stale');
    return summary;
  }

  let state: ReturnType<typeof punterPostedState>;
  try {
    state = punterPostedState(await listTrackPicksPostedSince(AI_PUNTER_TRACK, new Date(nowMs - RECENT_PICKS_MS).toISOString()), nowMs);
  } catch (e) {
    // Before the migration there is no `track` column: nothing is priced, reviewed or posted.
    summary.skipped.push(`Not posting until migrations/ai_picks_track.sql is run (${(e as Error).message})`);
    return summary;
  }
  // Same slate sizing as live NBA singles: upcoming board games + this arm's recent games.
  const slate = new Set(state.games);
  for (const c of scan.candidates) if (c.sport === 'nba') slate.add(gameIdentity(c));
  state.slateGames = slate.size;
  const prefix = trackWatchKey(AI_PUNTER_TRACK, '');
  const closed = new Set(
    (await listTrackWatchRows(AI_PUNTER_TRACK, eligible.map((e) => e.c.key)))
      .filter((r) => r.status === 'posted' || (r.status === 'dropped' && String(r.reason ?? '').startsWith(PUNTER_REVIEW_REJECTED)))
      .map((r) => r.candidate_key.slice(prefix.length))
  );

  const chosen = await chooseAtLivePrices(eligible, state, closed, params, nowMs, input.liveGames ?? new Map(), summary);
  if (!chosen.length) return summary;
  const plays: PunterPlay[] = chosen.map((e) => ({ proposal: punterProposal(e), reasons: e.case.angles.map((a) => a.text) }));
  summary.proposals = plays.map((p, i) => ({
    title: pickTitle([chosen[i]!.c]),
    price: p.proposal.price,
    marketEv: p.proposal.ev,
    reasons: chosen[i]!.case.angles.map((a) => a.key),
  }));

  const review = await reviewPunterPlays(plays);
  summary.review = { model: review.model, tokensIn: review.tokensIn, tokensOut: review.tokensOut, error: review.error };
  for (const [i, e] of chosen.entries()) {
    const verdict = review.verdicts.get(`P${i + 1}`);
    const title = pickTitle([e.c]);
    // No verdict (no reply, or a broken one) posts nothing; the play gets another look next scan.
    if (!verdict) continue;
    try {
      if (!verdict.approve) {
        const reason = `${PUNTER_REVIEW_REJECTED} [${verdict.category}] ${verdict.reason || 'no reason given'}`;
        await rejectTrackWatch(AI_PUNTER_TRACK, AI_PUNTER_POLICY, e.c.key, watchMeta(e), reason);
        summary.rejected.push({ title, reason: verdict.reason });
        continue;
      }
      const id = await post(e, plays[i]!, verdict.writeUp, verdict.reason, scan.scannedAt);
      if (id) summary.posted.push({ id, title });
      else summary.skipped.push(`${title}: already posted or turned down`);
    } catch (err) {
      summary.errors.push(`post ${title}: ${(err as Error).message}`);
    }
  }
  return summary;
}
