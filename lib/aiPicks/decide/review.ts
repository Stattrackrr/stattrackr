/**
 * Second opinion before anything is posted. The model's numbers found the play; the language model
 * reads the same evidence like a careful punter, rejects anything it would not back, and writes the
 * post. No reply, a bad reply, or a missing verdict means the play is not posted.
 */

import { askLlmConfig, callLlm } from '@/lib/ai/ask/llm';
import type { Proposal } from '@/lib/aiPicks/decide/select';
import { legTitle } from '@/lib/aiPicks/format';
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

Reject a play when:
- the evidence points the other way (recent hit rates mostly against it, projection on the wrong side of the line),
- it leans on a tiny or stale sample (few games this season, long layoff),
- the case is only that one bookmaker is out of line with the rest,
- for a multi, either leg would be rejected on its own.
Approve only plays you would genuinely back. Rejecting is normal; never approve to fill a quota.

For approved plays write the post: 2 or 3 sentences, under 70 words, plain Australian English, first person, confident but not hyped.
Speak as yourself ("I make it around 60%"), never about "the model". Round numbers the way a person would.
Use one or two concrete numbers from the evidence (a hit rate, the projection against the line, recent form).
No emojis, no hashtags, no "lock", no guarantees, no betting jargon like EV, de-vig or implied probability.
Never mention anything that is not in the evidence: no injuries, news, quotes or stats you were not given.

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
  if (c.sport === 'nbl' && proj) {
    extra.projectedStat = c.projection;
    extra.expectedMinutes = proj.expectedMinutes;
    extra.gamesThisSeason = proj.currentSeasonGames;
    extra.lastGame = String(proj.lastGameDate ?? '').slice(0, 10) || null;
    extra.marketExpects = ctx.marketMean;
    extra.opponent = ctx.opponent;
  } else if (c.sport === 'nbl') {
    extra.gameProjection = ctx.game;
  } else {
    extra.surface = ctx.surface;
    extra.tournament = ctx.tournament;
    extra.bestOf = ctx.bestOf;
    extra.form = ctx.form;
    extra.headToHead = ctx.h2h;
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
