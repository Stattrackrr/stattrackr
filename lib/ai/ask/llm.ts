/** One LLM client for every sport's ask AI. */

export type AskMessage = { role: 'user' | 'assistant'; content: string };
export type AskReplyText = { answer: string; breakdown: string[] };
export type AskLlmConfig = { provider: 'openai' | 'anthropic'; key: string; model: string };

/** `sportModel` is the per-sport override (e.g. TENNIS_ASK_MODEL); ASK_MODEL applies to every sport. */
export function askLlmConfig(sportModel?: string | null): AskLlmConfig | null {
  const override = String(sportModel || process.env.ASK_MODEL || '').trim();
  const openai = String(process.env.OPENAI_API_KEY || '').trim();
  if (openai) return { provider: 'openai', key: openai, model: override || 'gpt-5.6-luna' };
  const anthropic = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (anthropic) return { provider: 'anthropic', key: anthropic, model: override || 'claude-3-5-haiku-latest' };
  return null;
}

export type LlmCallOptions = { timeoutMs: number; maxTokens?: number; temperature?: number };
export type LlmReply = { text: string; tokensIn: number; tokensOut: number };

async function openaiReply(cfg: AskLlmConfig, system: string, turns: AskMessage[], opts: LlmCallOptions): Promise<LlmReply> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(opts.timeoutMs),
    body: JSON.stringify({
      model: cfg.model,
      max_completion_tokens: opts.maxTokens ?? 700,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, ...turns],
    }),
  });
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI ${res.status}`);
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty model response');
  return { text, tokensIn: json.usage?.prompt_tokens ?? 0, tokensOut: json.usage?.completion_tokens ?? 0 };
}

async function anthropicReply(cfg: AskLlmConfig, system: string, turns: AskMessage[], opts: LlmCallOptions): Promise<LlmReply> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(opts.timeoutMs),
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: opts.maxTokens ?? 700,
      temperature: opts.temperature ?? 0.8,
      system,
      messages: turns,
    }),
  });
  const json = (await res.json()) as {
    content?: Array<{ text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(json?.error?.message || `Anthropic ${res.status}`);
  const text = json.content
    ?.map((part) => part.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Empty model response');
  return { text, tokensIn: json.usage?.input_tokens ?? 0, tokensOut: json.usage?.output_tokens ?? 0 };
}

/** Like callAskLlm, with token usage and per-call limits. */
export function callLlm(cfg: AskLlmConfig, system: string, turns: AskMessage[], opts: LlmCallOptions): Promise<LlmReply> {
  return cfg.provider === 'openai' ? openaiReply(cfg, system, turns, opts) : anthropicReply(cfg, system, turns, opts);
}

export async function callAskLlm(cfg: AskLlmConfig, system: string, turns: AskMessage[], timeoutMs: number): Promise<string> {
  return (await callLlm(cfg, system, turns, { timeoutMs })).text;
}

function lightClean(raw: string): string {
  return String(raw || '')
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function parseAskReply(raw: string): AskReplyText {
  const trimmed = String(raw || '').trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { answer?: unknown; breakdown?: unknown };
      const answer = lightClean(String(parsed.answer || ''));
      const breakdown = Array.isArray(parsed.breakdown)
        ? parsed.breakdown
            .map((row) => lightClean(String(row || '')))
            .filter(Boolean)
            .slice(0, 8)
        : [];
      if (answer) return { answer, breakdown };
    } catch {
      /* fall through */
    }
  }
  const parts = trimmed
    .split(/\n+/)
    .map((row) => lightClean(row))
    .filter(Boolean);
  return {
    answer: parts[0] || 'Not enough in the stats to price that cleanly.',
    breakdown: parts.slice(1, 8),
  };
}

export function askReplyText(reply: AskReplyText): string {
  return `${reply.answer}\n${reply.breakdown.join('\n')}`;
}
