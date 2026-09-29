import { expectedValue, quarterKelly, round1, shownProb } from '@/lib/tennisAi/ev';
import type { AnswerPayload, ConfidenceTier } from '@/lib/tennisAi/types';

export const DEFAULT_FOOTER = '18+. Gamble responsibly. This is analysis, not a guarantee.';

export function responsibleGamblingFooter(): string {
  const custom = String(process.env.TENNIS_AI_RG_FOOTER || '').trim();
  return custom || DEFAULT_FOOTER;
}

const BANNED = [/guaranteed/i, /\blocks?\b/i, /can't lose|cant lose/i, /free money/i, /sure thing/i];

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function numbersIn(text: string): string[] {
  return text.match(/(?<![\d.])-?\d+(?:\.\d+)?/g) || [];
}

function collectNumbers(value: unknown, found: Set<string>) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    found.add(String(value));
    if (Number.isInteger(value)) found.add(value.toFixed(0));
    else found.add(String(Math.round(value * 1000) / 1000));
  } else if (typeof value === 'string') {
    for (const num of numbersIn(value)) found.add(num);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectNumbers(item, found));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectNumbers(item, found));
  }
}

export function surname(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const word = parts.filter((part) => part.replace(/[^A-Za-z]/g, '').length > 1).at(-1) || parts.at(-1) || name;
  return word.replace(/\.$/, '');
}

function nameCount(body: string, name: string): number {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body.match(new RegExp(escaped, 'gi'))?.length ?? 0;
}

function recommendsPick(body: string): boolean {
  const denied = body
    .replace(/would(?:n't| not) call anything value/gi, '')
    .replace(/\bno value\b/gi, '')
    .replace(/\bnot a value\b/gi, '');
  return /\bvalue\b/i.test(denied) || /\bback\b/i.test(body) || /bet on/i.test(body);
}

/** EV, edge and Kelly must match the quoted probability, the push, and the decimal odds. */
export function auditQuote(payload: AnswerPayload): string[] {
  const errors: string[] = [];
  const odds = payload.quoted?.odds ?? payload.market?.best_odds ?? null;
  const prob = payload.model.prob;
  if (odds == null || prob == null) return errors;
  const push = shownProb(payload.push_prob ?? 0);
  const shown = shownProb(prob);
  if (payload.ev_pct != null) {
    const ev = round1(expectedValue(shown, odds, push) * 100);
    if (Math.abs(ev - payload.ev_pct) > 0.05) {
      errors.push(`EV ${payload.ev_pct} does not match ${ev} from the probability and odds.`);
    }
  }
  if (payload.conservative_ev_pct != null && payload.model.interval) {
    const conservative = round1(expectedValue(shownProb(payload.model.interval[0]), odds, push) * 100);
    if (Math.abs(conservative - payload.conservative_ev_pct) > 0.05) {
      errors.push(`Conservative EV ${payload.conservative_ev_pct} does not match ${conservative}.`);
    }
  }
  if (payload.edge_pct != null && payload.market_fair_prob != null) {
    const edge = round1((shown - payload.market_fair_prob) * 100);
    if (Math.abs(edge - payload.edge_pct) > 0.15) {
      errors.push(`Edge ${payload.edge_pct} does not match ${edge}.`);
    }
  }
  if (payload.stake_pct != null && payload.model.interval) {
    const kelly = round1(quarterKelly(shownProb(payload.model.interval[0]), odds, push) * 100);
    if (Math.abs(kelly - payload.stake_pct) > 0.05) {
      errors.push(`Kelly ${payload.stake_pct} does not match ${kelly}.`);
    }
  }
  return errors;
}

function quotedTokens(value: number | null | undefined): string[] {
  if (value == null || !Number.isFinite(value)) return [];
  const tenth = Math.round(value * 10) / 10;
  return [String(value), String(tenth), tenth.toFixed(1)];
}

export function validateAnswer(text: string, payload: AnswerPayload): string[] {
  const errors: string[] = [];
  const body = String(text || '').trim();
  const count = words(body).length;
  if (count < 100 || count > 150) errors.push(`Word count ${count} is outside 100-150.`);
  const first = body.split(/[.!?]/)[0]?.trim().toLowerCase() || '';
  if (!/^(yes|lean yes|no\b|not worth|not one|honestly|i'd pass|i would pass)/.test(first)) {
    errors.push('The first sentence does not answer the question.');
  }
  const player = surname(payload.match.player);
  const opponent = surname(payload.match.opponent);
  if (nameCount(body, player) < 1 || nameCount(body, opponent) < 1) {
    errors.push('The answer does not compare both players.');
  }
  if (nameCount(body, player) > 2 || nameCount(body, opponent) > 2) {
    errors.push('A player name is repeated too often.');
  }
  for (const pattern of BANNED) {
    if (pattern.test(body)) errors.push(`Banned phrase: ${pattern}`);
  }
  const tier = payload.confidence_tier;
  const mayRecommend = tier === 'Strong value' || tier === 'Lean';
  if (!mayRecommend && recommendsPick(body)) {
    errors.push('Pick language is not allowed for this confidence tier.');
  }
  if (mayRecommend && !body.includes(payload.footer)) errors.push('Responsible-gambling footer is missing.');
  if (/settled bets|historical sample is/i.test(body)) {
    errors.push('The answer exposes a backtest count.');
  }
  const hidePrecise = tier === 'Insufficient data' || payload.needs_review;
  if (hidePrecise) {
    const hidden = [
      ...quotedTokens(payload.ev_pct),
      ...quotedTokens(payload.conservative_ev_pct),
      ...quotedTokens(payload.quoted.low_pct),
      ...quotedTokens(payload.quoted.high_pct),
    ];
    for (const num of numbersIn(body)) {
      if (hidden.includes(num)) errors.push(`Review answers cannot quote ${num}.`);
    }
  }
  errors.push(...auditQuote(payload));
  const allowed = new Set<string>();
  collectNumbers(payload, allowed);
  for (const item of [...allowed]) {
    const other = Number(item);
    if (!Number.isFinite(other)) continue;
    allowed.add(other.toFixed(1));
    allowed.add(other.toFixed(2));
  }
  for (const num of numbersIn(body)) {
    if (allowed.has(num)) continue;
    const value = Number(num);
    const near = [...allowed].some((item) => {
      const other = Number(item);
      return Number.isFinite(other) && Math.abs(other - value) < 0.001;
    });
    if (!near) errors.push(`Number ${num} is not in the payload.`);
  }
  return errors;
}

function pctText(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const tenth = Math.round(value * 10) / 10;
  return Number.isInteger(tenth) ? String(tenth) : tenth.toFixed(1);
}

export function quoteNumbers(payload: AnswerPayload): AnswerPayload['quoted'] {
  const pctOf = (value: number | null | undefined) =>
    value == null || !Number.isFinite(value) ? null : Math.round(value * 1000) / 10;
  const odds = payload.market?.best_odds ?? payload.market?.selected_odds ?? null;
  const rounded = odds == null ? null : Math.round(odds * 100) / 100;
  return {
    prob_pct: pctOf(payload.model.prob),
    fair_pct: pctOf(payload.market_fair_prob),
    low_pct: pctOf(payload.model.interval?.[0]),
    high_pct: pctOf(payload.model.interval?.[1]),
    odds: rounded,
    odds_label: rounded == null ? null : rounded.toFixed(2),
  };
}

function sidePhrase(payload: AnswerPayload, player: string, opponent: string): string {
  const market = payload.market;
  if (!market?.key) return player;
  const line = market.line;
  if (market.key === 'MATCH_WINNER') return market.selection === 'OPPONENT' ? opponent : player;
  if (market.key === 'TOTAL_GAMES' && line != null) return `${String(market.selection).toLowerCase()} ${line} games`;
  if (market.key === 'GAME_HANDICAP' && line != null) {
    const who = market.selection === 'OPPONENT' ? opponent : player;
    const signed = line > 0 ? `+${line}` : String(line);
    return `${who} ${signed} games`;
  }
  if (market.key === 'PLAYER_TOTAL_GAMES' && line != null) {
    return `${player} ${String(market.selection).toLowerCase()} ${line} games`;
  }
  if (line != null) return `${String(market.selection).toLowerCase()} ${line}`;
  return player;
}

function recordText(wins: number, losses: number): string {
  return `${wins}-${losses}`;
}

function formSentence(payload: AnswerPayload, player: string, opponent: string): string {
  const form = payload.form;
  if (!form) return '';
  const surface = payload.match.surface || 'this surface';
  if (form.playerSurfaceLast10N >= 8 && form.opponentSurfaceLast10N >= 8) {
    return `Last 10 on ${surface} is ${recordText(form.playerSurfaceLast10Wins, form.playerSurfaceLast10Losses)} for ${player} against ${recordText(form.opponentSurfaceLast10Wins, form.opponentSurfaceLast10Losses)} for ${opponent}.`;
  }
  if (form.playerSurfaceN > 0 && form.playerSurfaceN < 8 && form.playerLast10N >= 5 && form.opponentLast10N >= 5) {
    return `The ${surface} sample is only ${form.playerSurfaceN} matches, so last 10 overall is ${recordText(form.playerLast10Wins, form.playerLast10Losses)} for ${player} against ${recordText(form.opponentLast10Wins, form.opponentLast10Losses)} for ${opponent}.`;
  }
  if (form.playerSurfaceN > 0 && form.opponentSurfaceN > 0) {
    return `${player} is ${recordText(form.playerSurfaceWins, form.playerSurfaceLosses)} on ${surface} and ${opponent} is ${recordText(form.opponentSurfaceWins, form.opponentSurfaceLosses)}.`;
  }
  if (form.playerSurfaceN === 0 && form.opponentSurfaceN > 0) {
    return `${player} has no ${surface} matches on file, and ${opponent} is ${recordText(form.opponentSurfaceWins, form.opponentSurfaceLosses)}.`;
  }
  if (form.opponentSurfaceN === 0 && form.playerSurfaceN > 0) {
    return `${opponent} has no ${surface} matches on file, and ${player} is ${recordText(form.playerSurfaceWins, form.playerSurfaceLosses)}.`;
  }
  return '';
}

function h2hSentence(payload: AnswerPayload): string {
  const form = payload.form;
  if (!form) return '';
  if (form.h2hPlayed === 1) return 'They have played once, so head to head is not a sample.';
  if (form.h2hPlayed > 1) {
    const losses = form.h2hPlayed - form.h2hWins;
    return `Head to head is ${recordText(form.h2hWins, losses)}.`;
  }
  return 'They have not played, so head to head is not in this.';
}

function interpretStats(payload: AnswerPayload, player: string, opponent: string, useNames: boolean): string {
  const hold = payload.stat_comparison.find((row) => /hold/i.test(row.stat));
  const returns = payload.stat_comparison.find((row) => /return/i.test(row.stat));
  const parts: string[] = [];
  const oddHold = (value: number | null) => value != null && (value < 75 || value > 95);
  if (hold && oddHold(hold.player)) {
    parts.push(
      useNames
        ? `${player}'s ${hold.player}% hold against ${opponent} looks unusually ${hold.player != null && hold.player < 75 ? 'low' : 'high'}, which points to messy data`
        : `a ${hold.player}% hold looks unusually ${hold.player != null && hold.player < 75 ? 'low' : 'high'}, which points to messy data`
    );
  } else if (hold && oddHold(hold.opponent)) {
    parts.push(
      useNames
        ? `${opponent}'s ${hold.opponent}% hold against ${player} looks unusually ${hold.opponent != null && hold.opponent < 75 ? 'low' : 'high'}, which points to messy data`
        : `a ${hold.opponent}% hold looks unusually ${hold.opponent != null && hold.opponent < 75 ? 'low' : 'high'}, which points to messy data`
    );
  } else if (hold?.player != null && hold.opponent != null) {
    const gap = hold.player - hold.opponent;
    parts.push(
      Math.abs(gap) <= 1.5
        ? useNames
          ? `hold for ${player} and ${opponent} is ${hold.player} against ${hold.opponent}`
          : `hold is ${hold.player} against ${hold.opponent}`
        : useNames
          ? `hold is ${hold.player} for ${player} against ${hold.opponent} for ${opponent}`
          : `hold is ${hold.player} against ${hold.opponent}`
    );
  }
  if (returns?.player != null && returns.opponent != null) {
    parts.push(
      Math.abs(returns.player - returns.opponent) <= 1.5
        ? `return is ${returns.player} against ${returns.opponent}, basically level`
        : `return is ${returns.player} against ${returns.opponent}`
    );
  }
  if (!parts.length) return '';
  const sentence = `${parts.join(', and ')}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function fitLength(parts: string[]): string {
  const kept = parts.filter(Boolean);
  let text = kept.join(' ').replace(/\s+/g, ' ').trim();
  if (words(text).length < 100) {
    kept.push('A single loose service game can still swing a match, so there is no reason to force a pick.');
    text = kept.join(' ').replace(/\s+/g, ' ').trim();
  }
  const sentences = text.split(/(?<=\.)\s+/);
  while (words(text).length > 150 && sentences.length > 4) {
    sentences.splice(sentences.length - 2, 1);
    text = sentences.join(' ');
  }
  return text;
}

export function composeTemplate(payload: AnswerPayload): string {
  const player = surname(payload.match.player);
  const opponent = surname(payload.match.opponent);
  const tier = payload.confidence_tier;
  const hidePrecise = tier === 'Insufficient data' || payload.needs_review;
  const quoted = payload.quoted;
  const prob = pctText(quoted.prob_pct);
  const fair = pctText(quoted.fair_pct);
  const price = quoted.odds_label;
  const side = sidePhrase(payload, player, opponent);
  const form = formSentence(payload, player, opponent);
  const stats = interpretStats(payload, player, opponent, !form);
  const wideGap = payload.warnings.some((row) => /disagree by a lot/i.test(row)) || payload.needs_review;
  const wideBook = payload.warnings.some((row) => /unusually wide/i.test(row));
  const missing = !prob || !fair || !price;
  const bits: string[] = [];
  if (tier === 'Strong value' || tier === 'Lean') bits.push('Yes, it leans that way.');
  else if (hidePrecise) bits.push('Not one to touch.');
  else bits.push('Honestly, not really.');
  if (!missing) {
    bits.push(
      `On the numbers we're at ${prob}% for ${side}, but the book has that side at ${price}, which is about ${fair}% once the margin's out.`
    );
  } else if (payload.warnings.length) {
    const warning = payload.warnings[0];
    bits.push(warning.endsWith('.') ? warning : `${warning}.`);
  } else {
    bits.push(`There is no fresh two-sided price for ${player} against ${opponent}, so this is not a pick.`);
  }
  if (!missing && wideGap && hidePrecise) {
    bits.push(
      wideBook
        ? form
          ? `That's a huge gap, and the book is charging a fat margin.`
          : `That's a huge gap on a book that is charging a fat margin, and gaps that big are usually our data being wrong rather than the market.`
        : form
          ? `That's a huge gap against the matches on file.`
          : `That's a huge gap, and gaps that big are usually our data being wrong rather than the market.`
    );
  }
  if (form) bits.push(form);
  if (form || payload.form) bits.push(h2hSentence(payload));
  if (stats) bits.push(stats);
  if (!payload.backtest.approved) {
    bits.push(`We haven't validated this market yet, so I wouldn't call anything value here.`);
  } else if (!hidePrecise) {
    bits.push(`A past check has supported this market. That is history, not a promise.`);
  }
  if ((tier === 'Strong value' || tier === 'Lean') && price && payload.ev_pct != null) {
    bits.push(`The EV is ${payload.ev_pct}%, and I would keep any stake small, around ${payload.stake_pct ?? 0}% of the bankroll as a guide rather than an instruction.`);
    bits.push(payload.footer);
  } else if (!missing && !hidePrecise && payload.ev_pct != null) {
    bits.push(`The EV is ${payload.ev_pct}%, which is not enough to call an edge. I'd pass.`);
  } else {
    bits.push(`I'd pass. The price and the matches are not telling the same story.`);
  }
  return fitLength(bits);
}

export function preparePayload(payload: AnswerPayload): AnswerPayload {
  return { ...payload, quoted: quoteNumbers(payload), footer: payload.footer || responsibleGamblingFooter() };
}

export function fallbackAnswer(payload: AnswerPayload): string {
  const ready = preparePayload(payload);
  return composeTemplate(ready);
}

export type AnswerDraft = { answer: string; source: 'model' | 'template'; errors: string[] };

export async function composeAnswer(
  payload: AnswerPayload,
  llm?: (payload: AnswerPayload) => Promise<string>
): Promise<AnswerDraft> {
  const ready = preparePayload(payload);
  if (llm) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const raw = await llm(ready);
        const errors = validateAnswer(raw, ready);
        if (!errors.length) return { answer: raw.trim(), source: 'model', errors: [] };
      } catch {
        /* template below */
      }
    }
  }
  const answer = composeTemplate(ready);
  return { answer, source: 'template', errors: validateAnswer(answer, ready) };
}

export function tierAllowsPick(tier: ConfidenceTier): boolean {
  return tier === 'Strong value' || tier === 'Lean';
}
