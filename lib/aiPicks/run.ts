/**
 * One AI picks tick (cron, every 15 minutes): scan stored lines, update the watchlist, record
 * closing prices for legs about to start, choose what is ready, have the language model review it,
 * and post what it approves, staked from the edge and the AI's own track record.
 */

import { alternateBooks, bookKey } from '@/lib/aiPicks/books';
import { scanAiCandidates, type CandidateScan } from '@/lib/aiPicks/candidates';
import type { AiCandidate } from '@/lib/aiPicks/candidates/types';
import { candidateKey } from '@/lib/aiPicks/candidates/types';
import { reviewProposals, type ReviewResult } from '@/lib/aiPicks/decide/review';
import {
  chooseMulti,
  chooseSingles,
  POST_HORIZON_MS,
  qualifiesLeg,
  qualifiesSingle,
  subjectId,
  type Proposal,
  type Watched,
} from '@/lib/aiPicks/decide/select';
import { MIN_LEAD_MS } from '@/lib/aiPicks/decide/timing';
import { isClosedRow, nextWatchRow, postedState, REVIEW_REJECTED } from '@/lib/aiPicks/decide/watch';
import { pickTitle } from '@/lib/aiPicks/format';
import { isNblPropMarket } from '@/lib/aiPicks/markets';
import { round } from '@/lib/aiPicks/model/math';
import { loadActiveParams } from '@/lib/aiPicks/learn/state';
import { modelVersion, type AiPicksParams } from '@/lib/aiPicks/params';
import { sizeUnits, trackRecords, type TrackRecord } from '@/lib/aiPicks/units';
import {
  claimWatch,
  countOpenReviewRejections,
  finishRun,
  insertPick,
  listClosedMultiKeys,
  listPendingLegsStartingBetween,
  listPicksPostedSince,
  listSettledPickStats,
  listWatchingKeys,
  listWatchRows,
  readAiPicksSettings,
  releaseWatch,
  saveLegClosing,
  setWatchStatus,
  startRun,
  upsertWatchRows,
  type NewPickLeg,
  type WatchRow,
} from '@/lib/aiPicks/server';

/** How far back settled picks count toward a sport's track record. */
const TRACK_RECORD_MS = 365 * 86_400_000;
/** An NBL props board older than this is not trusted for posting. */
const MAX_BOARD_AGE_MS = 45 * 60 * 1000;
const CLOSING_WINDOW_MS = 45 * 60 * 1000;
const RECENT_PICKS_MS = 48 * 60 * 60 * 1000;
/** Multi legs kept on the watchlist per run, best EV first. */
const MAX_WATCHED_LEGS = 80;
/** Review budget: stop proposing once this many upcoming plays have been turned down. */
const MAX_OPEN_REJECTIONS = 12;
/** The cron is killed at 300s; past this a run skips review and posting rather than die mid-post. */
const REVIEW_CUTOFF_MS = 200_000;

export type AiPicksRunSummary = {
  scannedAt: string;
  modelVersion?: string;
  candidates: number;
  shortlisted: number;
  proposals: Array<{ kind: string; title: string; price: number; ev: number; reason: string }>;
  posted: Array<{ id: string; title: string }>;
  rejected: Array<{ title: string; reason: string }>;
  closingCaptured: number;
  paused: boolean;
  skipped: string[];
  review: { model: string | null; tokensIn: number; tokensOut: number; error: string | null } | null;
  /** Seconds spent in each step, to spot a slow source. */
  timings?: Record<string, number>;
  errors: string[];
};

/** Plays worth watching: anything that could be posted as a single or used as a multi leg. */
export function shortlist(scan: CandidateScan, params: AiPicksParams, nowMs: number, skipped: string[]): AiCandidate[] {
  const boardAt = scan.nbl?.boardUpdatedAt ? Date.parse(scan.nbl.boardUpdatedAt) : NaN;
  const boardStale = !(nowMs - boardAt <= MAX_BOARD_AGE_MS);
  if (boardStale && scan.candidates.some((c) => c.sport === 'nbl' && isNblPropMarket(c.market))) {
    skipped.push(`NBL props board is stale (${scan.nbl?.boardUpdatedAt ?? 'never updated'})`);
  }
  const usable = scan.candidates.filter((c) => !(boardStale && c.sport === 'nbl' && isNblPropMarket(c.market)));
  const byKey = new Map<string, AiCandidate>();
  for (const c of usable) if (qualifiesSingle(c, params, nowMs).ok) byKey.set(c.key, c);
  const legs = usable
    .filter((c) => !byKey.has(c.key) && qualifiesLeg(c, params, nowMs).ok)
    .sort((a, b) => b.ev - a.ev)
    .slice(0, MAX_WATCHED_LEGS);
  for (const c of legs) byKey.set(c.key, c);
  return [...byKey.values()];
}

function legRow(leg: Proposal['legs'][number], index: number): NewPickLeg {
  const c = leg.c;
  return {
    leg_index: index,
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
    price: leg.price,
    bookmaker: leg.book,
    model_prob: round(c.prob, 4),
  };
}

function pickContext(p: Proposal, review: string, scannedAt: string, staking: string): Record<string, unknown> {
  return {
    scannedAt,
    whyNow: p.reason,
    review,
    staking,
    altBooks: alternateBooks(p.legs.map((l) => l.c.quotes), p.book),
    legs: p.legs.map((l) => ({
      key: l.c.key,
      prob: l.c.prob,
      modelProb: l.c.modelProb,
      marketProb: l.c.marketProb,
      pushProb: l.c.pushProb,
      ev: l.c.ev,
      projection: l.c.projection,
      bestPrice: l.c.bestPrice,
      bestBook: l.c.bestBook,
      quotes: l.c.quotes.slice(0, 10),
      support: l.c.support,
      supportScore: l.c.supportScore,
      flags: l.c.flags,
      context: l.c.context,
    })),
  };
}

/** Latest pre-start price for legs about to start; the last write before the start is the close. */
async function captureClosing(candidates: AiCandidate[], nowMs: number): Promise<number> {
  const legs = await listPendingLegsStartingBetween(new Date(nowMs).toISOString(), new Date(nowMs + CLOSING_WINDOW_MS).toISOString());
  if (!legs.length) return 0;
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  let saved = 0;
  for (const leg of legs) {
    const c = byKey.get(candidateKey(leg));
    if (!c) continue;
    const sameBook = c.quotes.find((q) => bookKey(q.book) === bookKey(leg.bookmaker));
    await saveLegClosing(leg.id, leg.line, sameBook?.price ?? c.bestPrice);
    saved += 1;
  }
  return saved;
}

async function postProposal(
  p: Proposal,
  writeUp: string,
  review: string,
  params: AiPicksParams,
  records: Record<string, TrackRecord>,
  scannedAt: string
): Promise<string | null> {
  const stake = sizeUnits(p, params, records);
  const keys = p.kind === 'multi' ? [p.key, ...p.legs.map((l) => l.c.key)] : [p.key];
  const claimed: string[] = [];
  for (const key of keys) {
    if (!(await claimWatch(key))) {
      for (const k of claimed) await releaseWatch(k);
      return null;
    }
    claimed.push(key);
  }
  try {
    const legs = p.legs.map(legRow);
    return await insertPick(
      {
        kind: p.kind,
        sport: p.sport,
        title: pickTitle(p.legs.map((l) => l.c)),
        write_up: writeUp,
        units: stake.units,
        price: round(p.price, 3),
        bookmaker: p.book,
        model_prob: round(p.prob, 4),
        ev: round(p.ev, 4),
        first_starts_at: p.legs.map((l) => l.c.startsAt).sort()[0]!,
        model_version: modelVersion(params, p.legs.map((l) => l.c.sport)),
        context: pickContext(p, review, scannedAt, stake.why),
      },
      legs
    );
  } catch (e) {
    for (const k of claimed) await releaseWatch(k);
    throw e;
  }
}

function multiWatchRow(p: Proposal, nowIso: string): WatchRow {
  const first = p.legs[0]!.c;
  return {
    candidate_key: p.key,
    sport: p.sport,
    event_key: first.eventKey,
    starts_at: first.startsAt,
    market: 'multi',
    player: null,
    side: 'yes',
    line: null,
    best_price: p.price,
    bookmaker: p.book,
    model_prob: p.prob,
    ev: p.ev,
    score: null,
    status: 'watching',
    reason: null,
    history: [],
    first_seen_at: nowIso,
    last_seen_at: nowIso,
  };
}

export async function runAiPicks(nowMs = Date.now(), fixedParams?: AiPicksParams): Promise<AiPicksRunSummary> {
  const nowIso = new Date(nowMs).toISOString();
  const summary: AiPicksRunSummary = {
    scannedAt: nowIso,
    candidates: 0,
    shortlisted: 0,
    proposals: [],
    posted: [],
    rejected: [],
    closingCaptured: 0,
    paused: false,
    skipped: [],
    review: null,
    errors: [],
  };
  const startedAt = Date.now();
  let markAt = startedAt;
  const timings: Record<string, number> = {};
  const mark = (step: string) => {
    const now = Date.now();
    timings[step] = Math.round((now - markAt) / 100) / 10;
    markAt = now;
  };
  const runId = await startRun('scan');
  let review: ReviewResult | null = null;
  try {
    const params = fixedParams ?? (await loadActiveParams(summary.errors));
    summary.modelVersion = modelVersion(params, ['nbl', 'tennis']);
    const settings = await readAiPicksSettings();
    summary.paused = settings.paused;
    mark('setup');
    const scan = await scanAiCandidates({ nowMs, horizonMs: POST_HORIZON_MS, params });
    summary.errors.push(...scan.errors);
    summary.candidates = scan.candidates.length;
    mark('scan');

    try {
      summary.closingCaptured = await captureClosing(scan.candidates, nowMs);
    } catch (e) {
      summary.errors.push(`closing: ${(e as Error).message}`);
    }
    mark('closing');

    const short = shortlist(scan, params, nowMs, summary.skipped);
    summary.shortlisted = short.length;
    const existing = new Map((await listWatchRows(short.map((c) => c.key))).map((r) => [r.candidate_key, r]));
    const watched: Watched[] = [];
    const upserts: WatchRow[] = [];
    for (const c of short) {
      const next = nextWatchRow(c, existing.get(c.key), nowIso);
      if (!next) continue;
      upserts.push(next.row);
      watched.push({ c, history: next.history });
    }
    await upsertWatchRows(upserts);
    const seen = new Set(short.map((c) => c.key));
    const gone = (await listWatchingKeys()).filter((r) => !seen.has(r.candidate_key));
    const started = (r: { starts_at: string }) => Date.parse(r.starts_at) <= nowMs + MIN_LEAD_MS;
    await setWatchStatus(gone.filter(started).map((r) => r.candidate_key), 'expired', 'Started');
    await setWatchStatus(
      gone.filter((r) => !started(r) && !r.candidate_key.startsWith('multi|')).map((r) => r.candidate_key),
      'dropped',
      'No longer qualifies'
    );
    mark('watchlist');

    const openRejections = settings.paused ? 0 : await countOpenReviewRejections(nowIso);
    if (settings.paused) {
      summary.skipped.push('Posting is paused');
    } else if (Date.now() - startedAt > REVIEW_CUTOFF_MS) {
      summary.skipped.push(`Scan took ${Math.round((Date.now() - startedAt) / 1000)}s; review and posting wait for the next run`);
    } else if (openRejections >= MAX_OPEN_REJECTIONS) {
      summary.skipped.push(`${openRejections} upcoming plays already turned down on review; waiting for those games to start`);
    } else {
      const state = postedState(await listPicksPostedSince(new Date(nowMs - RECENT_PICKS_MS).toISOString()), nowMs);
      const singles = chooseSingles(watched, params, state, nowMs);
      const singleKeys = new Set(singles.map((s) => s.key));
      const closedMultis = new Set(await listClosedMultiKeys(new Date(nowMs - RECENT_PICKS_MS).toISOString()));
      const multi = chooseMulti(watched, params, state, nowMs, {
        keys: singleKeys,
        rejected: closedMultis,
        subjects: new Set(singles.map((s) => subjectId(s.legs[0]!.c))),
      });
      const proposals: Proposal[] = [...singles];
      if (multi) {
        const prior = (await listWatchRows([multi.key]))[0];
        if (!isClosedRow(prior)) {
          if (!prior) await upsertWatchRows([multiWatchRow(multi, nowIso)]);
          proposals.push(multi);
        }
      }
      summary.proposals = proposals.map((p) => ({
        kind: p.kind,
        title: pickTitle(p.legs.map((l) => l.c)),
        price: p.price,
        ev: p.ev,
        reason: p.reason,
      }));

      if (proposals.length) {
        const records = trackRecords(await listSettledPickStats(new Date(nowMs - TRACK_RECORD_MS).toISOString()), nowMs);
        mark('select');
        review = await reviewProposals(proposals);
        mark('review');
        summary.review = { model: review.model, tokensIn: review.tokensIn, tokensOut: review.tokensOut, error: review.error };
        for (const [i, p] of proposals.entries()) {
          const verdict = review.verdicts.get(`P${i + 1}`);
          const title = pickTitle(p.legs.map((l) => l.c));
          if (!verdict) continue;
          if (!verdict.approve) {
            await setWatchStatus([p.key], 'dropped', `${REVIEW_REJECTED} ${verdict.reason || 'not backed'}`);
            summary.rejected.push({ title, reason: verdict.reason });
            continue;
          }
          try {
            const id = await postProposal(p, verdict.writeUp, verdict.reason, params, records, scan.scannedAt);
            if (id) summary.posted.push({ id, title });
            else summary.skipped.push(`${title}: claimed by another run`);
          } catch (e) {
            summary.errors.push(`post ${title}: ${(e as Error).message}`);
          }
        }
        mark('post');
      }
    }
  } catch (e) {
    summary.errors.push((e as Error).message);
  }
  timings.total = Math.round((Date.now() - startedAt) / 100) / 10;
  summary.timings = timings;
  await finishRun(runId, {
    considered: summary.shortlisted,
    posted: summary.posted.length,
    tokensIn: review?.tokensIn ?? 0,
    tokensOut: review?.tokensOut ?? 0,
    summary: { ...summary },
    error: summary.errors.length ? summary.errors.slice(0, 5).join(' | ') : null,
  });
  return summary;
}
