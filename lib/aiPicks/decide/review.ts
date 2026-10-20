/**
 * Second opinion before anything is posted. The model's numbers found the play; the language model
 * reads the same evidence like a careful punter, rejects anything it would not back, and writes the
 * post. No reply, a bad reply, or a missing verdict means the play is not posted.
 */

import { askLlmConfig, callLlm } from '@/lib/ai/ask/llm';
import type { Proposal } from '@/lib/aiPicks/decide/select';
import { legTitle } from '@/lib/aiPicks/format';
import { isNbaAchievementMarket } from '@/lib/aiPicks/markets';
import { round } from '@/lib/aiPicks/model/math';
import { AI_PICKS_TZ } from '@/lib/aiPicks/decide/timing';

export type ReviewVerdict = { approve: boolean; reason: string; writeUp: string };
export type ReviewResult = {
  verdicts: Map<string, ReviewVerdict>;
  tokensIn: number;
  tokensOut: number;
  model: string | null;
  error: string | null;
};

const TIMEOUT_MS = 45_000;
const MAX_WRITE_UP = 700;

const SYSTEM = `You are Stattrackr AI, a disciplined sports bettor posting your own picks in a betting community.
A pricing model has shortlisted the plays below. For each one, read the evidence and decide whether you would put your own money on it.

Weigh all of the evidence, not just hit rates:
- NBL props: the projection against the line and what moved it (adjustments), averages over the last 5 / last 10 / season, minutes and usage trend, the matchup rank and opponent defence, pace, home/away split, teammates and opponents out, rest.
- NBL game lines: both teams' offensive and defensive ratings, pace, the points model, players out, rest.
- NBA props: the projection against the line and what moved it (how the opponent defends his position, pace, teammates out), averages over the last 5 / last 10 / season, minutes, usage, shot attempts and the tracking numbers given (rebound chances, passes, touches), opponents out, rest. Early in the season the numbers lean on last season; weigh role and minutes changes carefully.
- NBA double-double / triple-double (yes bets: 10+ in two / three of points, rebounds, assists, steals, blocks): his projected points, rebounds and assists and expected minutes, how often he got there over the last 5 / 10 / 15 / season, and the stat that usually falls short. These sit on minutes: a blowout risk or minutes cap is the main way they lose.
- NBA game lines: both teams' offensive and defensive ratings per 100 possessions, expected pace, regulars out, back to backs. NBA markets are sharp: only back a side when the evidence clearly agrees.
- Tennis: serve and return points won (surface weighted, adjusted for opponent strength), hold rate, break points saved and converted, first and second serve, Elo overall and on the surface, rankings, form, head to head, rest and recent workload.

Reject a play when:
- the evidence points the other way (projection or averages on the wrong side of the line, a falling minutes or usage trend, a tough matchup, recent records mostly against it),
- it leans on a tiny or stale sample (few games this season, long layoff),
- the case is only that one bookmaker is out of line with the rest,
- for a multi, either leg would be rejected on its own.
Approve only plays you would genuinely back. Rejecting is normal; never approve to fill a quota.

For approved plays write the post: 2 or 3 sentences, under 70 words, plain Australian English, first person, confident but not hyped.
Speak as yourself ("I make it around 60%"), never about "the model". Round numbers the way a person would.
Use one or two concrete numbers from the evidence (a projection against the line, an average, a matchup rank, a serve stat).
No emojis, no hashtags, no "lock", no guarantees, no betting jargon like EV, de-vig or implied probability.
Never mention anything that is not in the evidence: no news, quotes, injuries or stats you were not given.

Reply with JSON only:
{"reviews":[{"id":"P1","approve":true,"reason":"one short line for the log","writeUp":"the post, empty if rejected"}]}`;

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
    recentRecords: c.support.map((s) => `${s.label}: ${s.hits}/${s.games}`),
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

function clean(text: unknown): string {
  return String(text ?? '')
    .replace(/\*\*|__|#+\s/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_WRITE_UP);
}

export function parseReview(raw: string, count: number): Map<string, ReviewVerdict> {
  const out = new Map<string, ReviewVerdict>();
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  if (!match) return out;
  let parsed: { reviews?: Array<{ id?: unknown; approve?: unknown; reason?: unknown; writeUp?: unknown }> };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return out;
  }
  for (const r of parsed.reviews ?? []) {
    const id = String(r.id ?? '');
    const n = Number(id.replace(/^P/i, ''));
    if (!Number.isInteger(n) || n < 1 || n > count) continue;
    const writeUp = clean(r.writeUp);
    out.set(`P${n}`, { approve: r.approve === true && writeUp.length >= 20, reason: clean(r.reason).slice(0, 200), writeUp });
  }
  return out;
}

export async function reviewProposals(proposals: Proposal[]): Promise<ReviewResult> {
  const empty: ReviewResult = { verdicts: new Map(), tokensIn: 0, tokensOut: 0, model: null, error: null };
  if (!proposals.length) return empty;
  const cfg = askLlmConfig(process.env.AI_PICKS_MODEL);
  if (!cfg) return { ...empty, error: 'No LLM key configured' };
  try {
    const reply = await callLlm(cfg, SYSTEM, [{ role: 'user', content: JSON.stringify({ plays: reviewBrief(proposals) }) }], {
      timeoutMs: TIMEOUT_MS,
      maxTokens: Math.min(4000, 1200 + 400 * proposals.length),
      temperature: 0.4,
    });
    return { verdicts: parseReview(reply.text, proposals.length), tokensIn: reply.tokensIn, tokensOut: reply.tokensOut, model: cfg.model, error: null };
  } catch (e) {
    return { ...empty, model: cfg.model, error: (e as Error).message };
  }
}
