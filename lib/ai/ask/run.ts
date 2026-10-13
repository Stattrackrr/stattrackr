/**
 * The shared ask loop every sport runs: one AI reply, the shared and sport checks,
 * one rewrite when a check fails, and the sport's stats reply when the AI cannot be trusted.
 */

import { sharedAskChecks, type AskCheck } from '@/lib/ai/ask/guards';
import {
  askLlmConfig,
  callAskLlm,
  parseAskReply,
  type AskMessage,
  type AskReplyText,
} from '@/lib/ai/ask/llm';

export type AskReply = AskReplyText & { source: 'model' | 'stats' };

const FIRST_CALL_MS = 15_000;
/** The ask panels give up at 22s; AI calls must finish inside this, measured from the request arriving. */
const ASK_BUDGET_MS = 19_000;
const MIN_CALL_MS = 4_000;

function failures(reply: AskReplyText, checks: AskCheck[]): string[] {
  return checks.map((check) => check(reply)).filter((msg): msg is string => Boolean(msg));
}

export async function runAskAi(opts: {
  sportModel?: string | null;
  system: string;
  userContent: string;
  history?: AskMessage[];
  question: string;
  pack: unknown;
  local: AskReplyText;
  checks?: AskCheck[];
  allowLlm?: boolean;
  startedAt?: number;
}): Promise<AskReply> {
  const local: AskReply = { ...opts.local, source: 'stats' };
  if (opts.allowLlm === false) return local;
  const cfg = askLlmConfig(opts.sportModel);
  if (!cfg) return local;
  const started = opts.startedAt ?? Date.now();
  const left = () => ASK_BUDGET_MS - (Date.now() - started);
  const turns: AskMessage[] = [
    ...(opts.history || []).slice(-6).map((msg) => ({ role: msg.role, content: msg.content })),
    { role: 'user', content: opts.userContent },
  ];
  const checks = [...sharedAskChecks(opts.pack, opts.question), ...(opts.checks || [])];
  const firstMs = Math.min(FIRST_CALL_MS, left());
  if (firstMs < MIN_CALL_MS) return local;
  try {
    const raw = await callAskLlm(cfg, opts.system, turns, firstMs);
    let reply = parseAskReply(raw);
    if (!reply.answer) return local;
    let problems = failures(reply, checks);
    if (problems.length && left() >= MIN_CALL_MS) {
      try {
        const rewritten = parseAskReply(
          await callAskLlm(
            cfg,
            opts.system,
            [
              ...turns,
              { role: 'assistant', content: raw },
              {
                role: 'user',
                content: `${problems.join('\n')}\nKeep the same pick unless a fix forces a change. Return the same JSON shape.`,
              },
            ],
            left()
          )
        );
        if (rewritten.answer) {
          reply = rewritten;
          problems = failures(reply, checks);
        }
      } catch {
        /* judged below on the first reply */
      }
    }
    if (problems.length) return local;
    return {
      answer: reply.answer,
      breakdown: reply.breakdown.length ? reply.breakdown : opts.local.breakdown,
      source: 'model',
    };
  } catch {
    return local;
  }
}
