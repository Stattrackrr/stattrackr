import {
  compactTennisAnalysis,
  type TennisMatchAnalysis,
} from '@/lib/tennis/matchAnalyst';

export type TennisAskMessage = { role: 'user' | 'assistant'; content: string };
export type TennisAskReply = { answer: string; breakdown: string[]; source: 'model' | 'stats' };

function llmConfigured(): { provider: 'openai' | 'anthropic'; key: string; model: string } | null {
  const openai = String(process.env.OPENAI_API_KEY || '').trim();
  if (openai) {
    return {
      provider: 'openai',
      key: openai,
      model: String(process.env.TENNIS_ASK_MODEL || 'gpt-5.6-luna').trim() || 'gpt-5.6-luna',
    };
  }
  const anthropic = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (anthropic) {
    return {
      provider: 'anthropic',
      key: anthropic,
      model: String(process.env.TENNIS_ASK_MODEL || 'claude-3-5-haiku-latest').trim() || 'claude-3-5-haiku-latest',
    };
  }
  return null;
}

export function tennisAskConfigured(): boolean {
  return llmConfigured() != null;
}

const SYSTEM_PROMPT = `You are StatTrackr's tennis match analyst.

You only interpret the JSON pack. You never invent, guess, or round change any number.

Return JSON only:
{"answer":"string","breakdown":["string","string","string"]}

Answer rules:
- First sentence states the model pick, the line asked about, and the percent chance from the pack.
- Second sentence is exactly: Here's why.
- If the pack does not have that market or number, say the model does not have it. Do not make one up.
- If they ask about winning by a game line, use ONLY that line. 1.5 uses Cover15Pct, 2.5 uses Cover25Pct, 3.5 uses Cover35Pct, 5.5 uses Cover55Pct.
- Never swap in a different line. If they asked 5.5, do not mention 1.5 or 2.5.
- Write game lines as "win by 5.5 games", never as plus or minus lines.
- Write records as "9 wins and 1 loss". The pack already uses that wording.
- Never use these characters in answer or breakdown: / * -
- Never use markdown, bullets, or tables.
- Percent signs are allowed, like 65%.
- Breakdown is 3 to 5 short plain sentences, each a fact from the pack (hold percent, break percent, last 10, expected margin, H2H).
- No betting guarantees. No lock language.

Example answer: Our model predicts Zverev will win by 2.5 games with a 65% chance. Here's why.`;

function winLossWords(record: string): string {
  const match = String(record || '').trim().match(/^(\d+)\s*-\s*(\d+)/);
  if (!match) return String(record || '');
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  return `${wins} win${wins === 1 ? '' : 's'} and ${losses} loss${losses === 1 ? '' : 'es'}`;
}

function cleanAnalystText(raw: string): string {
  return String(raw || '')
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s\/\s/g, ' and ')
    .replace(/(\d+)\s*-\s*(\d+)/g, (_, wins, losses) => winLossWords(`${wins}-${losses}`))
    .replace(/\b(?:Games?\s*)?[+−–-](\d+(?:\.\d+)?)/gi, ' $1')
    .replace(/\s[−–—·•]\s/g, '. ')
    .replace(/([A-Za-z])-(?=[A-Za-z])/g, '$1 ')
    .replace(/[/*]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();
}

function parseAskReply(raw: string): { answer: string; breakdown: string[] } {
  const trimmed = String(raw || '').trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { answer?: unknown; breakdown?: unknown };
      const answer = cleanAnalystText(String(parsed.answer || ''));
      const breakdown = Array.isArray(parsed.breakdown)
        ? parsed.breakdown
            .map((row) => cleanAnalystText(String(row || '')))
            .filter(Boolean)
            .slice(0, 6)
        : [];
      if (answer) return { answer, breakdown };
    } catch {
      /* fall through */
    }
  }
  const parts = trimmed
    .split(/\n+/)
    .map((row) => cleanAnalystText(row))
    .filter(Boolean);
  return {
    answer: parts[0] || 'The model does not have an answer for that.',
    breakdown: parts.slice(1, 6),
  };
}

function askedGamesLine(question: string): number | null {
  const q = String(question || '').toLowerCase();
  const byLine = q.match(/win by\s+(\d+(?:\.\d+)?)/);
  if (byLine) return Number(byLine[1]);
  const coverLine = q.match(/(?:cover|handicap|spread)\s+(?:minus\s+|plus\s+)?(\d+(?:\.\d+)?)/);
  if (coverLine) return Number(coverLine[1]);
  const gamesLine = q.match(/(\d+(?:\.\d+)?)\s*games/);
  if (gamesLine) return Number(gamesLine[1]);
  return null;
}

function gamesCoverPct(
  model: TennisMatchAnalysis['model'],
  side: 'player' | 'opponent',
  line: number
): number | null {
  const key = Number(line).toFixed(1);
  const player = side === 'player';
  if (key === '1.5') return player ? model.playerCover15Pct : model.opponentCover15Pct;
  if (key === '2.5') return player ? model.playerCover25Pct : model.opponentCover25Pct;
  if (key === '3.5') return player ? model.playerCover35Pct : model.opponentCover35Pct;
  if (key === '5.5') return player ? model.playerCover55Pct : model.opponentCover55Pct;
  return null;
}

function lineLockText(question: string, analysis: TennisMatchAnalysis): string {
  const line = askedGamesLine(question);
  if (line == null) return '';
  const side = namedSide(question, analysis) || 'player';
  const name = side === 'player' ? analysis.player.last : analysis.opponent.last;
  const pct = gamesCoverPct(analysis.model, side, line);
  if (pct == null) {
    return `LINE LOCK: The user asked about ${line} games. That exact line is not in the pack. Do not answer with 1.5 or 2.5.`;
  }
  return `LINE LOCK: The user asked about ${name} winning by ${line} games. Use ${pct}% for that line only. Do not mention any other game line.`;
}

function askUserContent(question: string, analysis: TennisMatchAnalysis): string {
  const lock = lineLockText(question, analysis);
  return `${lock ? `${lock}\n\n` : ''}MODEL PACK:\n${JSON.stringify(compactTennisAnalysis(analysis))}\n\nQUESTION:\n${question}`;
}

function isPricedQuestion(question: string): boolean {
  const q = String(question || '').toLowerCase();
  return (
    askedGamesLine(q) != null ||
    /\bace/.test(q) ||
    /\btotal|over|under|22\.5|21\.5/.test(q) ||
    /\bbiggest edge|moneyline|who wins|win the match|should i back|straight sets\b/.test(q)
  );
}

function namedSide(question: string, analysis: TennisMatchAnalysis): 'player' | 'opponent' | null {
  const q = question.toLowerCase();
  const playerHit = [analysis.player.last, analysis.player.name].some((name) =>
    q.includes(String(name || '').toLowerCase())
  );
  const oppHit = [analysis.opponent.last, analysis.opponent.name].some((name) =>
    q.includes(String(name || '').toLowerCase())
  );
  if (playerHit && !oppHit) return 'player';
  if (oppHit && !playerHit) return 'opponent';
  return null;
}

function pctLabel(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function localBreakdown(analysis: TennisMatchAnalysis): string[] {
  const { player, opponent, model, h2h } = analysis;
  const lines: string[] = [];
  if (player.l15.holdPct != null && opponent.l15.holdPct != null) {
    lines.push(
      `${player.last} has held ${player.l15.holdPct}% of service games over the last 15. ${opponent.last} has held ${opponent.l15.holdPct}%.`
    );
  }
  if (player.l15.breakPct != null && opponent.l15.breakPct != null) {
    lines.push(
      `${player.last} has broken ${player.l15.breakPct}% of return games over the last 15. ${opponent.last} has broken ${opponent.l15.breakPct}%.`
    );
  }
  lines.push(
    `${player.last} is ${winLossWords(player.l10.record)} over the last 10. ${opponent.last} is ${winLossWords(opponent.l10.record)}.`
  );
  lines.push(
    `The model expects ${model.winner} to win by about ${Math.abs(model.expectedWinnerMargin)} games on average.`
  );
  if (h2h.matches) {
    lines.push(`Head to head is ${winLossWords(h2h.record)} for ${player.last}.`);
  }
  return lines.slice(0, 5);
}

function buildLocalAskReply(analysis: TennisMatchAnalysis, question: string): { answer: string; breakdown: string[] } {
  const q = String(question || '').toLowerCase();
  const { player, opponent, model } = analysis;
  const breakdown = localBreakdown(analysis);
  const side = namedSide(q, analysis);
  const gamesLine = askedGamesLine(q);

  if (gamesLine != null) {
    const targetSide = side || 'player';
    const name = targetSide === 'player' ? player.last : opponent.last;
    const pct = gamesCoverPct(model, targetSide, gamesLine);
    if (pct == null) {
      return {
        answer: cleanAnalystText(
          `The model does not price a ${gamesLine} game line. It expects ${model.winner} to win by about ${Math.abs(model.expectedWinnerMargin)} games. Here's why.`
        ),
        breakdown,
      };
    }
    const chance = pctLabel(pct);
    const answer =
      pct >= 50
        ? `Our model predicts ${name} will win by ${gamesLine} games with a ${chance} chance. Here's why.`
        : `Our model does not predict ${name} will win by ${gamesLine} games. It gives that a ${chance} chance. Here's why.`;
    return { answer: cleanAnalystText(answer), breakdown };
  }

  if (/straight sets/.test(q)) {
    const targetSide = side || 'player';
    const name = targetSide === 'player' ? player.last : opponent.last;
    const pct = gamesCoverPct(model, targetSide, 5.5);
    return {
      answer: cleanAnalystText(
        pct == null
          ? `The model does not price straight sets. It expects ${model.winner} to win by about ${Math.abs(model.expectedWinnerMargin)} games. Here's why.`
          : `The model does not price straight sets. The closest read is ${name} winning by 5.5 games at a ${pctLabel(pct)} chance. Here's why.`
      ),
      breakdown,
    };
  }

  if (/\bace/.test(q)) {
    const aces = analysis.edges.find((row) => row.id === 'aces');
    if (!aces) {
      return { answer: "The model does not have an aces price for this match. Here's why.", breakdown };
    }
    const lean = /under/i.test(aces.selection) ? 'stay under' : 'go over';
    return {
      answer: cleanAnalystText(
        `Our model predicts total aces to ${lean} ${aces.line} with a ${pctLabel(aces.probability)} chance. Here's why.`
      ),
      breakdown,
    };
  }

  if (/\btotal|over|under|22\.5|21\.5/.test(q)) {
    const totals = analysis.edges.find((row) => row.id === 'totals');
    if (!totals) {
      return { answer: "The model does not have a totals price for this match. Here's why.", breakdown };
    }
    const lean = /under/i.test(totals.selection) ? 'stay under' : 'go over';
    return {
      answer: cleanAnalystText(
        `Our model predicts the total to ${lean} ${totals.line} games with a ${pctLabel(totals.probability)} chance. Here's why.`
      ),
      breakdown,
    };
  }

  const winPct = side === 'opponent' ? model.opponentWinPct : side === 'player' ? model.playerWinPct : model.winnerSide === 'player' ? model.playerWinPct : model.opponentWinPct;
  const name = side === 'opponent' ? opponent.last : side === 'player' ? player.last : model.winner;
  if (side && name !== model.winner) {
    return {
      answer: cleanAnalystText(
        `Our model does not pick ${name} to win the match. It gives ${name} a ${pctLabel(winPct)} chance. Here's why.`
      ),
      breakdown,
    };
  }
  return {
    answer: cleanAnalystText(
      `Our model predicts ${name} will win the match with a ${pctLabel(winPct)} chance. Here's why.`
    ),
    breakdown,
  };
}

async function openaiReasoning(
  key: string,
  model: string,
  question: string,
  analysis: TennisMatchAnalysis,
  history: TennisAskMessage[]
): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 500,
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-6).map((msg) => ({ role: msg.role, content: msg.content })),
        {
          role: 'user',
          content: askUserContent(question, analysis),
        },
      ],
    }),
  });
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
  if (!res.ok) throw new Error(json?.error?.message || `OpenAI ${res.status}`);
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty model response');
  return text;
}

async function anthropicReasoning(
  key: string,
  model: string,
  question: string,
  analysis: TennisMatchAnalysis,
  history: TennisAskMessage[]
): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages: [
        ...history.slice(-6).map((msg) => ({ role: msg.role, content: msg.content })),
        {
          role: 'user',
          content: askUserContent(question, analysis),
        },
      ],
    }),
  });
  const json = (await res.json()) as { content?: Array<{ text?: string }>; error?: { message?: string } };
  if (!res.ok) throw new Error(json?.error?.message || `Anthropic ${res.status}`);
  const text = json.content?.map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('Empty model response');
  return text;
}

export async function answerTennisAsk(opts: {
  question: string;
  analysis: TennisMatchAnalysis;
  history?: TennisAskMessage[];
  allowLlm?: boolean;
}): Promise<TennisAskReply> {
  const local = buildLocalAskReply(opts.analysis, opts.question);
  if (opts.allowLlm === false) return { ...local, source: 'stats' };
  const cfg = llmConfigured();
  if (!cfg) return { ...local, source: 'stats' };
  const history = opts.history || [];
  try {
    const raw =
      cfg.provider === 'openai'
        ? await openaiReasoning(cfg.key, cfg.model, opts.question, opts.analysis, history)
        : await anthropicReasoning(cfg.key, cfg.model, opts.question, opts.analysis, history);
    const parsed = parseAskReply(raw);
    const askedLine = askedGamesLine(opts.question);
    const wrongLine =
      askedLine != null &&
      parsed.breakdown.some((row) =>
        ['1.5', '2.5', '3.5', '5.5'].some(
          (line) => line !== askedLine.toFixed(1) && row.includes(`${line} games`)
        )
      );
    return {
      answer: askedLine != null || isPricedQuestion(opts.question) ? local.answer : parsed.answer,
      breakdown: wrongLine || !parsed.breakdown.length ? local.breakdown : parsed.breakdown,
      source: 'model',
    };
  } catch {
    return { ...local, source: 'stats' };
  }
}
