/** Checks every sport's AI reply must pass. Each returns a rewrite instruction, or null when the reply is fine. */

import type { AskReplyText } from '@/lib/ai/ask/llm';
import { askReplyText } from '@/lib/ai/ask/llm';

export type AskCheck = (reply: AskReplyText) => string | null;

export function soundsLikeModelPitch(text: string): boolean {
  return (
    /\b(the model|our model|model has|model chance|model edge|model projection|positive edge|%\s*edge|\bEV\b|no-vig|kelly|fair price|verdict)\b/i.test(text) ||
    /\bno edge\b/i.test(text) ||
    /\bAVOID\b/.test(text) ||
    /\b(STRONG|LEAN)\s+(OVER|UNDER)\b/.test(text)
  );
}

export function soundsLikePackLeak(text: string): boolean {
  return /\b(stat pack|the pack|userLine|user line|graded|hit-rate call|side lean|suggestedTake|lastPlayed|currentStreak|onFileSince)\b/i.test(text);
}

function numbersIn(text: string): string[] {
  return (text.match(/(?<![\w.])-?\d+(?:\.\d+)?/g) || []).map((num) => num.replace(/^-/, ''));
}

function collectNumbers(value: unknown, found: Set<string>) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const abs = Math.abs(value);
    found.add(String(abs));
    found.add(String(Math.round(abs * 10) / 10));
    found.add(String(Math.round(abs)));
  } else if (typeof value === 'string') {
    for (const num of numbersIn(value)) {
      found.add(num);
      const n = Number(num);
      if (Number.isFinite(n)) found.add(String(Math.round(n)));
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectNumbers(item, found));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectNumbers(item, found));
  }
}

/** Numbers in the reply that are not anywhere in the pack or the question. */
export function askInventedNumbers(text: string, pack: unknown, question = ''): string[] {
  const allowed = new Set<string>();
  collectNumbers(pack, allowed);
  collectNumbers(question, allowed);
  return [...new Set(numbersIn(text).filter((num) => !allowed.has(num) && !allowed.has(String(Number(num)))))];
}

export type AskPriceOffer = { side: 'over' | 'under'; line: number; price: number };

/** "under 5.5 ... at 1.75" pairs in the reply whose price is not actually offered for that side and line. */
export function askMismatchedPrices(text: string, offers: AskPriceOffer[]): string[] {
  const bad: string[] = [];
  for (const m of text.matchAll(/\b(over|under)\s+(\d+(?:\.\d)?)\b[^.\d]{0,60}?\bat\s+\$?(\d+\.\d{1,2})\b/gi)) {
    const side = m[1]!.toLowerCase() as 'over' | 'under';
    const line = Number(m[2]);
    const price = Number(m[3]);
    const offered = offers.some(
      (o) => o.side === side && Math.abs(o.line - line) < 1e-6 && Math.abs(o.price - price) < 0.006
    );
    if (!offered) bad.push(`${side} ${line} at ${m[3]}`);
  }
  return bad;
}

export function askPriceCheck(offers: AskPriceOffer[]): AskCheck {
  return (reply) => {
    const bad = askMismatchedPrices(askReplyText(reply), offers);
    return bad.length
      ? `These prices are not offered for that side and line: ${bad.join('; ')}. Only quote a price listed for that exact side and line. If the side you like has no price, say there is no price for it.`
      : null;
  };
}

export function sharedAskChecks(pack: unknown, question: string): AskCheck[] {
  return [
    (reply) => {
      const extra = askInventedNumbers(askReplyText(reply), pack, question);
      return extra.length
        ? `These numbers are not in the stats: ${extra.join(', ')}. Rewrite using only numbers that appear in the stats, and drop any point you cannot back with them.`
        : null;
    },
    (reply) =>
      soundsLikeModelPitch(askReplyText(reply))
        ? 'Do not mention a model, edge, EV, fair price, verdict, or labels like STRONG, LEAN, NO EDGE or AVOID. Rewrite it as a punter giving an opinion from the stats.'
        : null,
    (reply) =>
      soundsLikePackLeak(askReplyText(reply))
        ? 'Do not mention the stat pack or any field names. Rewrite it in plain words.'
        : null,
  ];
}
