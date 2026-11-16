/**
 * Data check before anything is posted. The model's numbers chose the play; the language model only
 * vetoes data problems (wrong player, contradictory availability, stale or broken numbers), with a
 * category so vetoed plays can be compared with the rest, and writes the post. Judging probability
 * was tried and its rejects lost as often as its approvals. No reply, a bad reply, or a missing
 * verdict means the play is not posted.
 */

import { askLlmConfig, callLlm } from '@/lib/ai/ask/llm';
import type { Proposal } from '@/lib/aiPicks/decide/select';
import { legTitle } from '@/lib/aiPicks/format';
import { isNbaAchievementMarket } from '@/lib/aiPicks/markets';
import { round } from '@/lib/aiPicks/model/math';
import { AI_PICKS_TZ } from '@/lib/aiPicks/decide/timing';

/** Why a play was vetoed; 'none' when approved. Logged so vetoed plays can be compared with the rest. */
export const VETO_CATEGORIES = ['identity', 'injury_news', 'stale_data', 'other'] as const;
export type VetoCategory = (typeof VETO_CATEGORIES)[number] | 'none';
export type ReviewVerdict = { approve: boolean; category: VetoCategory; reason: string; writeUp: string };
export type ReviewResult = {
  verdicts: Map<string, ReviewVerdict>;
  tokensIn: number;
  tokensOut: number;
  model: string | null;
  error: string | null;
};

const TIMEOUT_MS = 45_000;
const MAX_WRITE_UP = 700;
const MAX_PUNTER_WRITE_UP = 1600;

const VETO_RULES = `Veto a play only for one of these, and give its category:
- "identity": the evidence contradicts itself about who this is (his recent games are for a different team than the one listed, or the stats in the evidence cannot belong to the same player).
- "injury_news": the evidence contradicts itself on who is playing (the player is listed out or has not played in weeks, or the case needs a teammate who is listed out).
- "stale_data": numbers that are clearly stale or broken (last game long ago with no note, impossible values, averages or a projection that cannot be right).
- "other": any other clear data error; say what it is.
Never veto because you disagree with the edge, think the line is close, or dislike recent form. Only veto for something you can point to in the evidence itself. Approving is the default when the data is sound.`;

const SYSTEM = `You are Stattrackr AI, posting picks in a betting community.
A pricing model has already chosen the plays below and decided they are worth betting. You do not judge the price, the probability, the projection, form or the matchup: that is the model's call.
Your two jobs: check each play for data problems, and write the post for the ones that pass.

Your own knowledge of rosters, trades and injuries is out of date. The teams, games and stats in the evidence come from today's official data; trust them over your memory, and never veto because a player's team or role surprises you.

${VETO_RULES}

For approved plays write the post: 2 or 3 sentences, under 70 words, plain Australian English, first person, confident but not hyped.
Lead with the concrete reason in the evidence: the projection against the line and what moved it (minutes, teammates out, matchup, pace). Speak as yourself ("I make it around 60%"), never about "the model". Round numbers the way a person would.
Never rest the post on someone being questionable or day-to-day: the numbers assume he plays his normal role.
No emojis, no hashtags, no "lock", no guarantees, no streak talk, no betting jargon like EV, de-vig or implied probability.
Never mention anything that is not in the evidence: no news, quotes, injuries or stats you were not given.

Reply with JSON only:
{"reviews":[{"id":"P1","approve":true,"category":"none","reason":"one short line for the log","writeUp":"the post, empty if vetoed"}]}`;

/**
 * Punter arm (admin-only test track): fixed rules chose the play from a list of checked reasons
 * (lib/aiPicks/punter). The same data veto applies; the post is written from those reasons alone.
 */
const PUNTER_SYSTEM = `You are Stattrackr AI, writing up a bet for a betting community the way a sharp form analyst would.
A fixed set of rules has already chosen the plays below from the reasons listed with each one. You do not judge the price or whether the reasons are strong enough: that is the rules' call.
Your two jobs: check each play for data problems, and write the post for the ones that pass.

Your own knowledge of rosters, trades and injuries is out of date. The teams, games and stats in the evidence come from today's official data; trust them over your memory, and never veto because a player's team or role surprises you.

${VETO_RULES}

For approved plays write the post from "reasons" only: each reason is a checked fact with its numbers. "checks" is there for the data check and is never quoted.
Write 3 or 4 short paragraphs, 90 to 170 words in total, separated by blank lines, in plain Australian English, confident but not hyped.
Keep the order the reasons come in: the run of matchups he is coming out of, what tonight's opponent gives up, the teammate who is out and what he has done without him, his record against this opponent, then one short closing line on rest. Leave out any of these that is not in the reasons.
Use the numbers as given, rounded the way a person would. Never add a number, ranking, injury, quote or piece of news that is not in the reasons, and never state a probability or a projection.
No emojis, no hashtags, no "lock", no guarantees, no betting jargon like EV, de-vig or implied probability.

Reply with JSON only:
{"reviews":[{"id":"P1","approve":true,"category":"none","reason":"one short line for the log","writeUp":"the post, empty if vetoed"}]}`;

function whenLocal(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', { timeZone: AI_PICKS_TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function pct(p: number | null | undefined): string | null {
  return p == null ? null : `${Math.round(p * 1000) / 10}%`;
}

function legEvidence(leg: Proposal['legs'][number]) {
  const c = leg.c;
  const ctx = c.context as Record<string, unknown>;
  const proj = ctx.projection as Record<string, unknown> | undefined;
  const extra: Record<string, unknown> = {};
  if (c.sport === 'nba' && isNbaAchievementMarket(c.market)) {
    extra.projected = ctx.projections;
    extra.projectedBeforeAdjustments = ctx.baseProjections;
    extra.expectedMinutes = ctx.expectedMinutes;
    extra.minutesSwing = ctx.minutesSd;
    extra.opponent = ctx.opponent;
    extra.playerStats = ctx.evidence;
    extra.gameFacts = ctx.facts;
  } else if ((c.sport === 'nbl' || c.sport === 'nba') && proj) {
    extra.projectedStat = c.projection;
    extra.projectionBeforeAdjustments = ctx.baseProjection;
    extra.adjustments = (ctx.factors as Array<{ factor: number; note: string }> | undefined)?.map(
      (f) => `${f.note} (${f.factor >= 1 ? '+' : ''}${Math.round((f.factor - 1) * 1000) / 10}%)`
    );
    extra.expectedMinutes = proj.expectedMinutes;
    extra.gamesThisSeason = proj.currentSeasonGames;
    extra.lastGame = String(proj.lastGameDate ?? '').slice(0, 10) || null;
    extra.marketExpects = ctx.marketMean;
    extra.opponent = ctx.opponent;
    extra.playerStats = ctx.evidence;
    extra.gameFacts = ctx.facts;
  } else if (c.sport === 'nbl' || c.sport === 'nba') {
    extra.gameProjection = ctx.game;
    extra.projectionBeforeRatingsAndInjuries = ctx.baseGame;
    extra.teamRatings = ctx.teams;
    extra.homeOut = ctx.homeOut;
    extra.awayOut = ctx.awayOut;
    if (c.sport === 'nba') {
      extra.homeRestDays = ctx.homeRestDays;
      extra.awayRestDays = ctx.awayRestDays;
    }
  } else {
    extra.surface = ctx.surface;
    extra.tournament = ctx.tournament;
    extra.bestOf = ctx.bestOf;
    extra.form = ctx.form;
    extra.headToHead = ctx.h2h;
    extra.servePointWinChance = ctx.serve;
    extra.serveAndReturnRates = ctx.serveReturn;
    extra.matchWinnerParts = ctx.winParts;
    extra.elo = ctx.elo;
    extra.rest = ctx.rest;
    extra.playerStats = ctx.evidence;
    extra.contextNotes = ctx.notes;
  }
  return {
    selection: legTitle({ ...c }),
    event: c.eventLabel,
    starts: whenLocal(c.startsAt),
    price: `${leg.price} at ${leg.book}`,
    booksPricingIt: c.quotes.length,
    ourChance: pct(c.prob),
    modelAlone: pct(c.modelProb),
    marketChance: pct(c.marketProb),
    notes: c.flags,
    ...extra,
  };
}

export function reviewBrief(proposals: Proposal[]): Array<Record<string, unknown>> {
  return proposals.map((p, i) => ({
    id: `P${i + 1}`,
    type: p.kind === 'multi' ? `${p.legs.length}-leg multi` : 'single',
    combinedPrice: p.kind === 'multi' ? `${p.price} at ${p.book}` : undefined,
    ourChance: pct(p.prob),
    returnPerUnitIfRight: round(p.price - 1, 2),
    whyNow: p.reason,
    legs: p.legs.map(legEvidence),
  }));
}

/** A punter-arm play: the proposal and the reasons (one checked fact each) the rules chose it on. */
export type PunterPlay = { proposal: Proposal; reasons: string[] };

/** Notes about the live model's own numbers, which the punter arm does not use. */
const LIVE_MODEL_NOTE = /differ by|too big to trust|Thin support|leaning on the market|Long shot/;

/** The reasons to write from, and the data the veto checks; the live model's projection is left out. */
export function punterReviewBrief(plays: PunterPlay[]): Array<Record<string, unknown>> {
  return plays.map(({ proposal, reasons }, i) => {
    const leg = proposal.legs[0]!;
    const c = leg.c;
    const ctx = c.context as Record<string, unknown>;
    const proj = ctx.projection as Record<string, unknown> | undefined;
    return {
      id: `P${i + 1}`,
      selection: legTitle({ ...c }),
      event: c.eventLabel,
      starts: whenLocal(c.startsAt),
      price: `${leg.price} at ${leg.book}`,
      reasons,
      checks: {
        booksPricingIt: c.quotes.length,
        marketChance: pct(c.marketProb),
        notes: c.flags.filter((f) => !LIVE_MODEL_NOTE.test(f)),
        opponent: ctx.opponent,
        gamesThisSeason: proj?.currentSeasonGames,
        lastGame: String(proj?.lastGameDate ?? '').slice(0, 10) || null,
        playerStats: ctx.evidence,
        gameFacts: ctx.facts,
      },
    };
  });
}

function clean(text: unknown, max = MAX_WRITE_UP): string {
  const raw = String(text ?? '')
    .replace(/\*\*|__|#+\s/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
  // Live posts stay one block; the punter arm's longer case keeps its paragraphs.
  const normalized =
    max > MAX_WRITE_UP
      ? raw
          .split(/\n+/)
          .map((p) => p.replace(/[ \t]+/g, ' ').trim())
          .filter(Boolean)
          .join('\n\n')
      : raw.replace(/\s+/g, ' ');
  return normalized.slice(0, max);
}

export function parseReview(raw: string, count: number, maxWriteUp = MAX_WRITE_UP): Map<string, ReviewVerdict> {
  const out = new Map<string, ReviewVerdict>();
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  if (!match) return out;
  let parsed: { reviews?: Array<{ id?: unknown; approve?: unknown; category?: unknown; reason?: unknown; writeUp?: unknown }> };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return out;
  }
  for (const r of parsed.reviews ?? []) {
    const id = String(r.id ?? '');
    const n = Number(id.replace(/^P/i, ''));
    if (!Number.isInteger(n) || n < 1 || n > count) continue;
    const writeUp = clean(r.writeUp, maxWriteUp);
    const minLen = maxWriteUp > MAX_WRITE_UP ? 40 : 20;
    const approve = r.approve === true && writeUp.length >= minLen;
    const named = VETO_CATEGORIES.find((c) => c === r.category);
    const category: VetoCategory = approve ? 'none' : named ?? 'other';
    const reason = clean(r.reason, 200) || (r.approve === true ? 'Approved without a usable write-up' : '');
    out.set(`P${n}`, { approve, category, reason, writeUp });
  }
  return out;
}

async function runReview(proposals: Proposal[], system: string, brief: Array<Record<string, unknown>>, maxWriteUp: number): Promise<ReviewResult> {
  const empty: ReviewResult = { verdicts: new Map(), tokensIn: 0, tokensOut: 0, model: null, error: null };
  if (!proposals.length) return empty;
  const cfg = askLlmConfig(process.env.AI_PICKS_MODEL);
  if (!cfg) return { ...empty, error: 'No LLM key configured' };
  try {
    const reply = await callLlm(cfg, system, [{ role: 'user', content: JSON.stringify({ plays: brief }) }], {
      timeoutMs: TIMEOUT_MS,
      maxTokens: Math.min(maxWriteUp > MAX_WRITE_UP ? 8000 : 4000, 1200 + (maxWriteUp > MAX_WRITE_UP ? 900 : 400) * proposals.length),
      temperature: 0.4,
    });
    return {
      verdicts: parseReview(reply.text, proposals.length, maxWriteUp),
      tokensIn: reply.tokensIn,
      tokensOut: reply.tokensOut,
      model: cfg.model,
      error: null,
    };
  } catch (e) {
    return { ...empty, model: cfg.model, error: (e as Error).message };
  }
}

export async function reviewProposals(proposals: Proposal[]): Promise<ReviewResult> {
  return runReview(proposals, SYSTEM, reviewBrief(proposals), MAX_WRITE_UP);
}

/** Data veto and write-up for the punter arm's plays. */
export async function reviewPunterPlays(plays: PunterPlay[]): Promise<ReviewResult> {
  return runReview(
    plays.map((p) => p.proposal),
    PUNTER_SYSTEM,
    punterReviewBrief(plays),
    MAX_PUNTER_WRITE_UP
  );
}
