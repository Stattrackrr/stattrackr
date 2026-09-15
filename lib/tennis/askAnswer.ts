import {
  compactTennisAnalysis,
  type TennisMatchAnalysis,
} from '@/lib/tennis/matchAnalyst';
import { buildTennisAskBrief } from '@/lib/tennis/askBrief';
import {
  evaluateUserStatLine,
  formatUserLineWindow,
  parseUserStatLine,
  userLineClears,
  type UserLineEval,
} from '@/lib/tennis/askUserLine';

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

const LENSES = [
  'serve hold versus return pressure',
  'ace and double-fault markets',
  'game totals and set shape',
  'H2H versus current form',
  'rank-band and style splits',
  'similar-player results against this opponent',
  'surface and first-serve patterns',
  'break points and who actually gets broken',
] as const;

const SYSTEM_PROMPT = `You are a sharp tennis betting analyst on StatTrackr. Talk like a punter texting a mate — short, casual, opinionated. Not like a preview blurb or a research note.

Use ONLY facts and numbers in the STAT PACK. Never invent a stat, line, rank, score, or percentage. If a market is missing, say you do not have a model price, then still give a stats-based betting read.

How to write:
- Vary how you open. Do not start every answer the same way.
- Never write "Here's why."
- Never say play up, selling sets, live with, or other analyst-speak.
- Never use the canned line "Our model predicts X with a Y% chance" unless they specifically asked for the model price.
- Dig into whatever stats matter for THIS question and THIS matchup. Use serve, return, aces, DF, hold, break, DR, games won/lost, totals, sets, first serve, second serve, BP, surface, H2H, rank bands, style splits, DVP, recent scorelines, and similar-player results when they help.
- Do not recycle the same three facts every time. If two stats disagree, say so.
- Be specific: names, numbers, surfaces, last 10 / last 15, H2H scores.
- No lock, guaranteed, or sure-thing language.
- Answer in 2 to 4 sentences a punter can use. Then breakdown: 4 to 7 short sentences, each a different fact. Do not repeat the answer.
- Format first: format.bestOf is this match. ATP slams are best of 5. If bestOf is 5, never mention 21.5 or 22.5 unless the user typed that number. Those are BO3 lines.
- Totals: totals.listedBookLine is the book total for THIS match. Use that line and the book prices in marketOdds. Model projection is model.expectedTotalGames. Do not invent a 22.5 over-percent in a best of 5.
- Edge: value.moneyline and value.totals compare model % to book implied (no-vig when both sides exist). Positive edge means the model is higher than the book. Quote those when they ask who to back or if a line is good. If those books are empty, say we do not have a price.
- H2H game averages are often from BO3 meetings. Do not compare h2h.avgGames to a BO5 38.5–43.5 total.
- User-named numbers: if they ask "11+ aces", "over 8.5 aces", "is 10 aces good", or "over 43.5 games", that number is THEIR line. Grade it with userLine in the STAT PACK. Do not say there is no line. Never say pack field names in the answer.
- Book ace lines: if listedPlayerAceLine or listedMatchAceLine is null, there is NO book ace line. Never compare one player's aces to 11.5 unless they named that number.

Return JSON only:
{"answer":"string","breakdown":["string","string"]}`;

function askedGamesLine(question: string): number | null {
  if (parseUserStatLine(question)) return null;
  const q = String(question || '').toLowerCase();
  const byLine = q.match(/win by\s+(\d+(?:\.\d+)?)/);
  if (byLine) return Number(byLine[1]);
  const coverLine = q.match(/(?:cover|handicap|spread)\s+(?:minus\s+|plus\s+|-|\+)?(\d+(?:\.\d+)?)/);
  if (coverLine) return Number(coverLine[1]);
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

function lightClean(raw: string): string {
  return String(raw || '')
    .replace(/\*\*/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseAskReply(raw: string): { answer: string; breakdown: string[] } {
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
    answer: parts[0] || 'Not enough in the pack to price that cleanly.',
    breakdown: parts.slice(1, 8),
  };
}

function buildAskPack(analysis: TennisMatchAnalysis, question: string) {
  const brief = buildTennisAskBrief({
    playerName: analysis.player.name,
    opponentName: analysis.opponent.name,
    tour: analysis.tour,
    isGrandSlam: analysis.bestOf === 5,
    tournamentName: analysis.tournamentName,
  });
  return {
    model: compactTennisAnalysis(analysis),
    brief,
    userLine: evaluateUserStatLine(analysis, brief, question),
  };
}

function localBreakdown(analysis: TennisMatchAnalysis): string[] {
  const { player, opponent, model, h2h } = analysis;
  const lines: string[] = [];
  if (player.l15.aces != null && opponent.l15.acesAllowed != null) {
    lines.push(
      `${player.last} is averaging ${player.l15.aces} aces over the last 15. ${opponent.last} has been allowing ${opponent.l15.acesAllowed}.`
    );
  }
  if (player.l15.holdPct != null && opponent.l15.breakPct != null) {
    lines.push(
      `${player.last} has held ${player.l15.holdPct}% lately. ${opponent.last} has broken ${opponent.l15.breakPct}%.`
    );
  }
  if (player.l15.df != null) {
    lines.push(`${player.last} is coughing up ${player.l15.df} double faults per match in that same window.`);
  }
  if (player.l15.totalGames != null && opponent.l15.totalGames != null) {
    lines.push(
      `${player.last} matches have been sitting around ${player.l15.totalGames} games. ${opponent.last} around ${opponent.l15.totalGames}.`
    );
  }
  lines.push(
    `${player.last} is ${player.l10.record} over the last 10. ${opponent.last} is ${opponent.l10.record}.`
  );
  if (h2h.matches) {
    lines.push(`Head to head is ${h2h.record} for ${player.last} across ${h2h.matches} matches.`);
  }
  lines.push(
    `The model still has ${model.winner} in front, expected margin about ${Math.abs(model.expectedWinnerMargin)} games.`
  );
  return lines.slice(0, 7);
}

function userLineBreakdown(evaled: UserLineEval, analysis: TennisMatchAnalysis): string[] {
  const lines = evaled.windows.slice(0, 5).map((row) => `${evaled.subject} ${formatUserLineWindow(row)} on ${evaled.asked.display}.`);
  if (evaled.similarVsOpponent) {
    lines.push(`${formatUserLineWindow(evaled.similarVsOpponent)} on ${evaled.asked.display}.`);
  }
  if (evaled.projection != null) {
    lines.push(`Projected ${evaled.asked.label} for ${evaled.subject} is ${evaled.projection}.`);
  }
  if (evaled.vsOpponentGames.length) {
    lines.push(
      `Vs ${analysis.opponent.last}: ${evaled.vsOpponentGames
        .slice(0, 4)
        .map((row) => `${row.value}${row.hit ? ' hit' : ' miss'}`)
        .join(', ')}.`
    );
  }
  return lines.slice(0, 7);
}

function buildLocalUserLineReply(
  evaled: UserLineEval,
  analysis: TennisMatchAnalysis
): { answer: string; breakdown: string[] } {
  const l15 = evaled.windows.find((row) => row.label === 'L15');
  const vs = evaled.windows.find((row) => row.label.startsWith('vs '));
  const rates = [l15?.pct, evaled.similarVsOpponent?.pct, vs?.pct].filter(
    (value): value is number => value != null
  );
  const avgHit = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : null;
  const projClears = evaled.projection != null && userLineClears(evaled.projection, evaled.asked);
  const hitBit = l15?.pct != null ? `${l15.pct}% of last ${l15.sample}` : null;
  const similarBit =
    evaled.similarVsOpponent?.pct != null
      ? `${evaled.similarVsOpponent.pct}% of similar players vs ${evaled.opponent}`
      : null;
  const projBit = evaled.projection != null ? `projection sits at ${evaled.projection}` : null;
  const facts = [hitBit, similarBit, projBit].filter(Boolean).join(', ');
  const leanYes = (avgHit != null && avgHit >= 55 && projClears) || (avgHit != null && avgHit >= 65);
  const leanNo =
    (avgHit != null && avgHit <= 40) || (evaled.projection != null && !projClears && (avgHit == null || avgHit < 55));
  const answer = leanYes
    ? `Yes — ${evaled.asked.display} looks like a live number for ${evaled.subject}${facts ? ` (${facts})` : ''}.`
    : leanNo
      ? `No — ${evaled.asked.display} is too spicy for ${evaled.subject}${facts ? ` (${facts})` : ''}.`
      : `${evaled.asked.display} is a coin flip for ${evaled.subject}${facts ? ` (${facts})` : ''}. I would not press it.`;
  return { answer, breakdown: userLineBreakdown(evaled, analysis) };
}

function buildLocalAskReply(
  analysis: TennisMatchAnalysis,
  question: string
): { answer: string; breakdown: string[] } {
  const q = String(question || '').toLowerCase();
  const { player, opponent, model } = analysis;
  const brief = buildTennisAskBrief({
    playerName: analysis.player.name,
    opponentName: analysis.opponent.name,
    tour: analysis.tour,
    isGrandSlam: analysis.bestOf === 5,
    tournamentName: analysis.tournamentName,
  });
  const userLine = evaluateUserStatLine(analysis, brief, question);
  if (userLine) return buildLocalUserLineReply(userLine, analysis);
  const breakdown = localBreakdown(analysis);
  const side = namedSide(q, analysis);
  const gamesLine = askedGamesLine(q);

  if (gamesLine != null) {
    const targetSide = side || 'player';
    const name = targetSide === 'player' ? player.last : opponent.last;
    const pct = gamesCoverPct(model, targetSide, gamesLine);
    if (pct == null) {
      return {
        answer: `No exact ${gamesLine} game-line price in the pack. The model still leans ${model.winner} by about ${Math.abs(model.expectedWinnerMargin)} games.`,
        breakdown,
      };
    }
    return {
      answer:
        pct >= 50
          ? `${name} covering ${gamesLine} games sits at ${pctLabel(pct)} on the model, so that is the lean, not a lock.`
          : `${name} covering ${gamesLine} games is only ${pctLabel(pct)} on the model. That is a pass unless the price is huge.`,
      breakdown,
    };
  }

  if (/\bace/.test(q)) {
    const playerAces = player.l15.aces;
    const oppAllowed = opponent.l15.acesAllowed;
    return {
      answer:
        playerAces != null
          ? `There is no listed player ace line on the chart. ${player.last} is at ${playerAces} aces over the last 15${
              oppAllowed != null ? `, and ${opponent.last} has been allowing ${oppAllowed}` : ''
            }, so I would judge the ace spot off that projection, not a fake 11.5.`
          : 'There is no listed ace line on the chart. Use the raw ace and ace-allowed numbers instead.',
      breakdown,
    };
  }

  if (/\btotal|over|under|games\b/.test(q)) {
    const line = model.totalsLine;
    const overPct = model.totalsOverPct;
    const listed = analysis.marketOdds?.listedTotalLine ?? line;
    return {
      answer:
        analysis.bestOf === 5
          ? `This is best of 5. The book total is ${listed}, not a 22.5. Projection is ${model.expectedTotalGames} games, so the over ${listed} sits around ${pctLabel(overPct)}.`
          : `Book total is ${listed}. Projection is ${model.expectedTotalGames} games, over sits around ${pctLabel(overPct)}.`,
      breakdown,
    };
  }

  const winPct =
    side === 'opponent'
      ? model.opponentWinPct
      : side === 'player'
        ? model.playerWinPct
        : model.winnerSide === 'player'
          ? model.playerWinPct
          : model.opponentWinPct;
  const name = side === 'opponent' ? opponent.last : side === 'player' ? player.last : model.winner;
  if (side && name !== model.winner) {
    return {
      answer: `I would not back ${name} on the moneyline from this pack. The model only has ${name} at ${pctLabel(winPct)}.`,
      breakdown,
    };
  }
  return {
    answer: `${name} is the model side at ${pctLabel(winPct)}. I would still check hold/break and the total before slamming the winner.`,
    breakdown,
  };
}

function askUserContent(question: string, analysis: TennisMatchAnalysis): string {
  const pack = buildAskPack(analysis, question);
  const userLine = parseUserStatLine(question);
  const line = askedGamesLine(question);
  const side = namedSide(question, analysis);
  const lens = LENSES[Math.floor(Math.random() * LENSES.length)];
  const formatLock =
    analysis.bestOf === 5
      ? `This match is BEST OF 5. Book total is ${analysis.marketOdds?.listedTotalLine ?? analysis.model.totalsLine}. Never quote 22.5.`
      : `This match is BEST OF 3. Book total is ${analysis.marketOdds?.listedTotalLine ?? analysis.model.totalsLine}.`;
  const lock = pack.userLine
    ? `The user named ${pack.userLine.asked.display} for ${pack.userLine.subject}. Grade THAT number with userLine hit rates. Do not invent a book line and do not swap in modelDefaultMatchTotal.`
    : userLine
      ? `The user named ${userLine.display}. Grade that number from the stats. Do not invent a book line.`
      : line != null
        ? `The user asked about a ${line} game cover${side ? ` for ${side === 'player' ? analysis.player.last : analysis.opponent.last}` : ''}. Use that line only if the pack has it.`
        : 'No specific user number was locked.';
  return `${formatLock}\n${lock}\nThis time lean on: ${lens}.\n\nSTAT PACK:\n${JSON.stringify(pack)}\n\nQUESTION:\n${question}`;
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
      max_completion_tokens: 1100,
      reasoning_effort: 'medium',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history.slice(-6).map((msg) => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: askUserContent(question, analysis) },
      ],
    }),
  });
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
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
      max_tokens: 1100,
      temperature: 0.8,
      system: SYSTEM_PROMPT,
      messages: [
        ...history.slice(-6).map((msg) => ({ role: msg.role, content: msg.content })),
        { role: 'user', content: askUserContent(question, analysis) },
      ],
    }),
  });
  const json = (await res.json()) as { content?: Array<{ text?: string }>; error?: { message?: string } };
  if (!res.ok) throw new Error(json?.error?.message || `Anthropic ${res.status}`);
  const text = json.content
    ?.map((part) => part.text || '')
    .join('')
    .trim();
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
    if (!parsed.answer) return { ...local, source: 'stats' };
    return {
      answer: parsed.answer,
      breakdown: parsed.breakdown.length ? parsed.breakdown : local.breakdown,
      source: 'model',
    };
  } catch {
    return { ...local, source: 'stats' };
  }
}
