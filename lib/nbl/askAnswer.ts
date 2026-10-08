/**
 * Request-time OpenAI write-up for the NBL props engine, same pattern as tennis:
 * the Python engine is the model; gpt-5.6-luna only restates numbers already in the pack.
 */

import { getNblClubByCode } from '@/lib/nblTeamCanonical';
import { nblPunterQuestions } from '@/lib/nbl/askSuggestions';
import { findNblEnginePanel, findNblEnginePlayerPicks, NBL_ASK_BEST_PLAY_STAT, rankNblPlayPicks, selectNblAskPick } from '@/lib/nbl/enginePicks';
import { readNblPlayerPropSnapshotByGameKey } from '@/lib/nbl/playerPropSnapshots';
import {
  nblEngineCategoryLabel,
  nblStoredLineQuotes,
  type NblEnginePanelPayload,
  type NblEnginePick,
} from '@/lib/nbl/engineShared';

export type NblAskMessage = { role: 'user' | 'assistant'; content: string };
export type NblAskReply = {
  answer: string;
  breakdown: string[];
  source: 'model' | 'stats';
  suggestions: string[];
  reason: string | null;
};

const STAT_ALIASES: Array<{ key: string; words: string[] }> = [
  { key: 'pra', words: ['pra', 'pts+reb+ast', 'points rebounds assists'] },
  { key: 'threeMade', words: ['3pm', 'threes', '3-pointers', '3pt', 'three'] },
  { key: 'rebounds', words: ['rebounds', 'rebound', 'boards', 'reb'] },
  { key: 'assists', words: ['assists', 'assist', 'ast'] },
  { key: 'points', words: ['points', 'pts', 'scoring'] },
  { key: 'pr', words: ['pts+reb', 'points + rebounds'] },
  { key: 'pa', words: ['pts+ast', 'points + assists'] },
  { key: 'ra', words: ['reb+ast', 'rebounds + assists'] },
];

function llmConfigured(): { key: string; model: string } | null {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) return null;
  const model =
    String(process.env.NBL_ASK_MODEL || process.env.TENNIS_ASK_MODEL || 'gpt-5.6-luna').trim() ||
    'gpt-5.6-luna';
  return { key, model };
}

export function nblAskConfigured(): boolean {
  return llmConfigured() != null;
}

function clubName(code: string | null | undefined): string {
  if (!code) return '';
  return getNblClubByCode(code)?.name || code;
}

function lastNameOf(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .at(-1) || String(name || '');
}

function leanSide(pick: NblEnginePick): 'over' | 'under' {
  if (pick.side === 'over' || pick.side === 'under') return pick.side;
  return pick.score_over >= pick.score_under ? 'over' : 'under';
}

function punterStance(pick: NblEnginePick): { stance: 'over' | 'under' | 'leave'; mixed: boolean } {
  if (pick.tier === 'AVOID') return { stance: 'leave', mixed: true };
  return { stance: leanSide(pick), mixed: pick.tier === 'NO EDGE' };
}

function matchStatFromQuestion(question: string, fallback: string): string {
  const q = question.toLowerCase();
  for (const row of STAT_ALIASES) {
    if (row.words.some((word) => q.includes(word))) return row.key;
  }
  return fallback;
}

export type NblAskIntent = 'take' | 'other_markets' | 'best_line' | 'shot' | 'model';

export function nblQuestionIntent(question: string): NblAskIntent {
  const q = question.toLowerCase();
  if (/\bwhere does\b|\bscore from\b|\bshot chart\b|\bfrom against\b/.test(q)) return 'shot';
  if (/\bhow do you see\b|\bwhat(?:'s| is) the (?:model|lean)\b/.test(q)) return 'model';

  // "best line AND market / quick bet / looking into" is a pick, not a price quote.
  const wantsAPlay =
    /\bquick bet\b|\bneed a bet\b|\ba bet for\b|\bbet for this\b/.test(q) ||
    /\blook(?:ing)? into\b|\blook(?:ing)? at\b/.test(q) ||
    /\bbest line and market\b|\bline and market\b/.test(q) ||
    /\bwhich market\b|\bwhat market\b|\band market\b/.test(q) ||
    /\bshould (?:i|we) (?:be )?(?:look|take|bet|back)/.test(q);
  if (wantsAPlay) {
    if (/\bother\b|\belse\b|\bbesides\b/.test(q)) return 'other_markets';
    return 'take';
  }

  if (
    /\bother markets?\b|\banother market\b|\bother lines?\b|\bother props?\b/.test(q) ||
    /\bwhat else\b|\banything else\b|\blook at instead\b/.test(q) ||
    /\bbesides (?:points|pts|this)\b|\bother than\b|\brest of the card\b|\bany other\b/.test(q)
  ) {
    return 'other_markets';
  }
  if (
    /\bif you had to\b/.test(q) ||
    /\bhad to (bet|take|play|pick)\b/.test(q) ||
    /\bpick a (?:prop|line|market|bet)\b/.test(q) ||
    /\bwho are (?:you|u) taking\b/.test(q) ||
    /\bwho(?:'re| are) (?:you|u) (?:taking|on|backing)\b/.test(q) ||
    /\bwhat line are (?:you|u) taking\b/.test(q) ||
    /\bwhich line (?:would you|are you|do you)\b/.test(q) ||
    /\bwhat(?:'s| is) your (?:take|play|bet|pick)\b/.test(q) ||
    /\bwhich (?:one|line|market|prop) (?:would you|are you|do you) (?:take|bet|play|pick)\b/.test(q) ||
    /\bwhat would you (?:take|bet|play|pick)\b/.test(q) ||
    /\bwhat are you taking\b|\bwhich would you take\b/.test(q) ||
    /\byour pick\b|\bwhich prop\b/.test(q) ||
    /\bwhich of (?:those|these|them)\b/.test(q)
  ) {
    return 'take';
  }
  if (
    /\bbest line\b|\bbest price\b|\bwhich book|\bbookies?\b/.test(q) ||
    /\bline to (take|bet)\b|\btake to bet\b|\bwhat(?:'s| is) the line\b|\bwhich line\b|\bwhat line\b/.test(q) ||
    /\bbest over\b|\bbest under\b|\bwhere to take\b|\bwhat to take\b|\bwhich number\b/.test(q)
  ) {
    return 'best_line';
  }
  return 'model';
}

function postedLines(pick: NblEnginePick | null): number[] {
  if (!pick) return [];
  const rows = pick.line_summary?.book_lines || [];
  const out = rows.map((row) => row.line);
  if (pick.line != null) out.push(pick.line);
  return out;
}

function lineNamedInQuestion(question: string, posted: number[]): number | null {
  const nums = [...question.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  for (const n of nums) {
    if (!Number.isFinite(n)) continue;
    if (posted.some((p) => Math.abs(p - n) < 1e-6)) return n;
  }
  return null;
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
            .slice(0, 5)
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
    breakdown: parts.slice(1, 6),
  };
}

function numbersIn(text: string): string[] {
  return text.match(/(?<![\d.])-?\d+(?:\.\d+)?/g) || [];
}

function collectNumbers(value: unknown, found: Set<string>) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    found.add(String(value));
    found.add(String(Math.round(value * 10) / 10));
    if (Number.isInteger(value)) found.add(value.toFixed(0));
  } else if (typeof value === 'string') {
    for (const num of numbersIn(value)) found.add(num);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectNumbers(item, found));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectNumbers(item, found));
  }
}

function inventedNumbers(text: string, pack: unknown): string[] {
  const allowed = new Set<string>();
  collectNumbers(pack, allowed);
  return numbersIn(text).filter((num) => !allowed.has(num));
}

function playerKeyOf(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bookBoardForPick(pick: NblEnginePick) {
  const snap = readNblPlayerPropSnapshotByGameKey(pick.game_key);
  if (!snap) return [];
  const key = playerKeyOf(pick.player_name);
  return snap.lines
    .filter(
      (row) =>
        row.stat === pick.stat &&
        (row.playerKey === key || playerKeyOf(row.player) === key)
    )
    .map((row) => ({
      book: row.book,
      kind: row.kind,
      line: row.line,
      label: row.label,
      overDecimal: row.overDecimal,
      underDecimal: row.underDecimal,
    }));
}

function booksTiedAt(
  board: ReturnType<typeof bookBoardForPick>,
  line: number | null | undefined,
  price: number | null | undefined,
  side: 'over' | 'under'
): string[] {
  if (line == null || price == null) return [];
  const key = side === 'over' ? 'overDecimal' : 'underDecimal';
  const names = board
    .filter((row) => row.line === line && row[key] === price)
    .map((row) => row.book);
  return [...new Set(names)];
}

function compactPick(pick: NblEnginePick, requestedLine?: number | null) {
  const board = bookBoardForPick(pick);
  const quotes = nblStoredLineQuotes(pick, { atLine: requestedLine });
  const overBooks = [...(quotes.bestOver?.books || [])];
  const underBooks = [...(quotes.bestUnder?.books || [])];
  if (quotes.bestOver && !overBooks.length) {
    overBooks.push(...booksTiedAt(board, quotes.bestOver.line, quotes.bestOver.price, 'over'));
  }
  if (quotes.bestUnder && !underBooks.length) {
    underBooks.push(...booksTiedAt(board, quotes.bestUnder.line, quotes.bestUnder.price, 'under'));
  }
  const bestOver = quotes.bestOver
    ? { ...quotes.bestOver, books: overBooks.length ? overBooks : quotes.bestOver.books }
    : null;
  const bestUnder = quotes.bestUnder
    ? { ...quotes.bestUnder, books: underBooks.length ? underBooks : quotes.bestUnder.books }
    : null;
  return {
    player: pick.player_name,
    team: pick.team_code,
    opponent: pick.opponent_code,
    opponentName: clubName(pick.opponent_code),
    isHome: pick.is_home,
    game: pick.game_label,
    tipoffUtc: pick.tipoff_utc,
    stat: pick.stat,
    statLabel: pick.stat_label,
    line: pick.line,
    side: pick.side,
    ...punterStance(pick),
    confirmed: pick.confirmed_categories.map(nblEngineCategoryLabel),
    failedGates: pick.gates.filter((g) => !g.passed).map((g) => ({ gate: g.gate, detail: g.detail })),
    bestOver,
    bestUnder,
    bookBoard: board,
    whyItHappened: {
      seasonGames: pick.claims.find((c) => c.metric === 'season_games')?.as_text ?? null,
      seasonSlate: pick.claims.find((c) => c.metric === 'season_slate')?.as_text ?? null,
      seasonVsDHits: pick.claims.find((c) => c.metric === 'season_vs_d_hits')?.as_text ?? null,
      h2hGames: pick.claims.find((c) => c.metric === 'h2h_games')?.as_text ?? null,
      h2hMinutesVsNow: pick.claims.find((c) => c.metric === 'h2h_minutes_vs_now')?.as_text ?? null,
      h2hHitRate: pick.claims.find((c) => c.metric === 'h2h_hit_rate')?.as_text ?? null,
    },
    forThePlay: pick.inferences
      .filter((inf) => inf.status === 'confirmed' && inf.direction === pick.side)
      .map((inf) => nblEngineCategoryLabel(inf.category)),
    againstThePlay: pick.inferences
      .filter(
        (inf) =>
          inf.status === 'confirmed' &&
          inf.direction !== 'neutral' &&
          inf.direction !== pick.side
      )
      .map((inf) => nblEngineCategoryLabel(inf.category)),
    rankConvention: {
      hardest: 1,
      easiest: 10,
      meaning:
        'Two lists. Shot-chart zone ranks (claims that say "shot-chart #N") match Opp Def Rank on the court. PTS D / "for PTS allowed" is box-score team allowed — a different ranking. Never mix them or "correct" a zone with PTS D.',
    },
    claims: pick.claims.map((c) => c.as_text),
    inferences: pick.inferences.map((inf) => ({
      category: nblEngineCategoryLabel(inf.category),
      direction: inf.direction,
      status: inf.status,
      reason: inf.reason,
    })),
  };
}

function buildPack(
  panel: NblEnginePanelPayload,
  intent: NblAskIntent,
  requestedLine?: number | null
) {
  const cardPicks = findNblEnginePlayerPicks({
    playerId: panel.pick?.player_id || null,
    playerName: panel.pick?.player_name || null,
    opponent: panel.game?.opponent_code || null,
  });
    const suggested = selectNblAskPick(cardPicks);
  return {
    engineVersion: panel.engine_version,
    generatedAt: panel.generated_at,
    game: panel.game,
    reason: panel.reason,
    hint: intent,
    requestedLine: requestedLine ?? null,
    viewing: panel.pick ? compactPick(panel.pick, requestedLine) : null,
    card: cardPicks.map(cardRow),
    suggestedTake: suggested ? cardRow(suggested) : null,
    markets: panel.markets.map(({ stat, stat_label, line, side, kind, bestOver, bestUnder }) => ({
      stat,
      stat_label,
      line,
      side,
      kind,
      bestOver,
      bestUnder,
    })),
    pick: panel.pick ? compactPick(panel.pick, requestedLine) : null,
    take: panel.pick ? takeQuote(panel.pick) : null,
  };
}

export function nblAskSuggestions(panel: NblEnginePanelPayload, playerName?: string | null): string[] {
  const player = playerName || panel.pick?.player_name || '';
  const opp = clubName(panel.game?.opponent_code) || '';
  return nblPunterQuestions(player, opp);
}

function formatQuote(
  q: { line: number; price: number; books: string[] } | null | undefined,
  side: 'over' | 'under',
  label?: string
): string | null {
  if (!q) return null;
  const books = q.books.length ? ` (${q.books.join(', ')})` : '';
  const market = label ? ` ${label}` : '';
  return `Best ${side} ${label} is ${q.line} at ${q.price}${books}`;
}

function localBestLineReply(
  panel: NblEnginePanelPayload,
  requestedLine?: number | null
): { answer: string; breakdown: string[] } {
  const pick = panel.pick;
  const stored = pick ? nblStoredLineQuotes(pick, { atLine: requestedLine }) : { bestOver: null, bestUnder: null };
  const markets = panel.markets || [];
  const focus = markets.find((m) => m.stat === pick?.stat) ?? markets[0];
  const over = stored.bestOver || focus?.bestOver;
  const under = stored.bestUnder || focus?.bestUnder;
  const main = requestedLine ?? focus?.line ?? pick?.line ?? null;
  const label = focus?.stat_label || pick?.stat_label || 'PTS';
  const overTxt = formatQuote(over, 'over', label);
  if (!overTxt && main == null) {
    return {
      answer: panel.reason || 'No sportsbook line was on the board when the engine last ran.',
      breakdown: [],
    };
  }
  let answer = overTxt
    ? `${overTxt}.`
    : `Main ${label} line is ${main}. No bettable over (1.50+) on the board.`;
  if (over && main != null && over.line !== main && requestedLine == null) {
    answer += ` Main ${label} line is ${main}.`;
  }
  const underTxt = formatQuote(under, 'under', label);
  if (underTxt && under && (!over || under.line !== over.line || under.price !== over.price)) {
    answer += ` ${underTxt}.`;
  }
  return { answer, breakdown: [] };
}

function cleanClaimText(text: string): string {
  const cleaned = lightClean(text)
    .replace(/\(\s*box score, not a shot-chart zone rank\.?\s*\)/gi, '')
    .replace(/\s*box score, not a shot-chart zone rank\.?/gi, '')
    .replace(/\s*One input among many[^.]*\./gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
  const sentence = cleaned.match(/^.+?[.](?=\s|$)/);
  return (sentence ? sentence[0] : cleaned).trim();
}

function takeQuote(pick: NblEnginePick): { side: 'over' | 'under'; quote: { line: number; price: number; books: string[] } } | null {
  const quotes = nblStoredLineQuotes(pick, { atLine: pick.line });
  const favored: 'over' | 'under' =
    pick.side === 'over' || pick.side === 'under'
      ? pick.side
      : pick.score_over >= pick.score_under
        ? 'over'
        : 'under';
  const favoredQuote = favored === 'over' ? quotes.bestOver : quotes.bestUnder;
  if (!favoredQuote) return null;
  return { side: favored, quote: favoredQuote };
}

function cardRow(pick: NblEnginePick) {
  const quotes = nblStoredLineQuotes(pick);
  const taken = takeQuote(pick);
  const side = leanSide(pick);
  return {
    stat: pick.stat,
    statLabel: pick.stat_label,
    line: pick.line,
    side,
    ...punterStance(pick),
    bestOver: quotes.bestOver,
    bestUnder: quotes.bestUnder,
    take: taken,
    priced: Boolean(taken),
    confirmed: pick.inferences
      .filter((inf) => inf.status === 'confirmed' && inf.direction === side && inf.reason)
      .map((inf) => ({
        category: nblEngineCategoryLabel(inf.category),
        direction: inf.direction,
        reason: inf.reason,
      })),
    pushback: pick.inferences
      .filter(
        (inf) =>
          inf.status === 'confirmed' &&
          inf.direction !== 'neutral' &&
          inf.direction !== side &&
          inf.reason
      )
      .map((inf) => ({
        category: nblEngineCategoryLabel(inf.category),
        direction: inf.direction,
        reason: inf.reason,
      })),
  };
}

function localTakeReply(panel: NblEnginePanelPayload): { answer: string; breakdown: string[] } {
  const pick = panel.pick;
  if (!pick) {
    return {
      answer: panel.reason || 'No sportsbook line was on the board when the engine last ran.',
      breakdown: [],
    };
  }
  const side = leanSide(pick);
  const line = pick.line;
  const taken = takeQuote(pick);
  const withPlay = pick.inferences.filter(
    (inf) => inf.status === 'confirmed' && inf.direction === side && inf.reason
  );
  const against = pick.inferences.filter(
    (inf) =>
      inf.status === 'confirmed' &&
      inf.direction !== 'neutral' &&
      inf.direction !== side &&
      inf.reason
  );
  const breakdown = [
    ...withPlay.map((inf) => `${nblEngineCategoryLabel(inf.category)}: ${cleanClaimText(inf.reason)}`),
    ...against
      .slice(0, 1)
      .map((inf) => `Pushback — ${nblEngineCategoryLabel(inf.category)}: ${cleanClaimText(inf.reason)}`),
  ].slice(0, 5);
  if (taken) {
    const books = taken.quote.books.length ? ` (${taken.quote.books.join(', ')})` : '';
    return {
      answer: `I'd take ${pick.stat_label} ${taken.side} ${taken.quote.line} at ${taken.quote.price}${books}.`,
      breakdown,
    };
  }
  if (line == null) {
    return {
      answer: `No bettable ${pick.stat_label} price (1.50+) on the board.`,
      breakdown,
    };
  }
  const other = nblStoredLineQuotes(pick).bestOver;
  const skipGimme = other
    ? ` I wouldn't take the ${other.line} over at ${other.price} — that's the other side.`
    : '';
  return {
    answer: `I'd be on ${pick.stat_label} ${side} ${line}. No ${side} price is on the board.${skipGimme}`,
    breakdown,
  };
}

function formatTakeLine(pick: NblEnginePick): string | null {
  const taken = takeQuote(pick);
  if (!taken) return null;
  const books = taken.quote.books.length ? ` (${taken.quote.books.join(', ')})` : '';
  return `${pick.stat_label} ${taken.side} ${taken.quote.line} at ${taken.quote.price}${books}`;
}

function marketWhy(pick: NblEnginePick, side: 'over' | 'under'): string {
  const support = pick.inferences.find(
    (inf) => inf.status === 'confirmed' && inf.direction === side && inf.reason
  );
  const matchup = pick.inferences.find(
    (inf) => inf.status === 'confirmed' && inf.category === 'matchup_allowed' && inf.reason
  );
  const hit = pick.inferences.find(
    (inf) => inf.status === 'confirmed' && inf.category === 'hit_rate' && inf.reason
  );
  return cleanClaimText(support?.reason || matchup?.reason || hit?.reason || '');
}

function localOtherMarketsReply(
  panel: NblEnginePanelPayload,
  lookup: { playerId?: string | null; playerName?: string | null; opponent?: string | null }
): { answer: string; breakdown: string[] } {
  const skipStat = panel.pick?.stat || 'points';
  const skipLabel = panel.pick?.stat_label || 'PTS';
  const picks = findNblEnginePlayerPicks({
    playerId: lookup.playerId || panel.pick?.player_id || null,
    playerName: lookup.playerName || panel.pick?.player_name || null,
    opponent: lookup.opponent || panel.game?.opponent_code || null,
  });
  const ranked = rankNblPlayPicks(picks.filter((p) => p.stat !== skipStat));
  const live = ranked.filter((p) => p.tier === 'STRONG' || p.tier === 'LEAN' || p.tier === 'NO EDGE');
  const others = (live.length ? live : ranked).slice(0, 3);
  if (!others.length) {
    return {
      answer: `No other bettable market besides ${skipLabel} is on the board.`,
      breakdown: [],
    };
  }
  const first = others[0];
  const taken = takeQuote(first);
  const head = formatTakeLine(first);
  const why = taken ? marketWhy(first, taken.side) : '';
  const answer = why ? `I'd look at ${head} first. ${why}` : `I'd look at ${head} first.`;
  const breakdown = others.map((p) => {
    const row = formatTakeLine(p);
    const q = takeQuote(p);
    const reason = q ? marketWhy(p, q.side) : '';
    return reason ? `${row}. ${reason}` : row || p.stat_label;
  });
  return { answer, breakdown: breakdown.slice(0, 4) };
}

function localShotReply(panel: NblEnginePanelPayload): { answer: string; breakdown: string[] } {
  const pick = panel.pick;
  if (!pick) {
    return {
      answer: panel.reason || 'No shot profile stored for this matchup.',
      breakdown: [],
    };
  }
  const shares = pick.claims.filter((c) => String(c.metric || '').startsWith('zone_share_'));
  const ranks = pick.claims.filter((c) => String(c.metric || '').startsWith('opp_zone_rank_'));
  const edge = pick.claims.find((c) => c.metric === 'zone_matchup_edge');
  const answer = shares[0]?.as_text || edge?.as_text || pick.narrative;
  return {
    answer,
    breakdown: [...shares.slice(1), ...ranks, edge].filter(Boolean).map((c) => c!.as_text).slice(0, 5),
  };
}

function localModelReply(panel: NblEnginePanelPayload): { answer: string; breakdown: string[] } {
  const pick = panel.pick;
  if (!pick) {
    return {
      answer: panel.reason || 'No sportsbook line was on the board when the engine last ran.',
      breakdown: [],
    };
  }
  const { stance, mixed } = punterStance(pick);
  const line = pick.line;
  const last = lastNameOf(pick.player_name);
  const opp = clubName(pick.opponent_code) || pick.opponent_code;
  const side = stance === 'leave' ? leanSide(pick) : stance;
  const withPlay = pick.inferences.filter(
    (inf) => inf.status === 'confirmed' && inf.direction === side && inf.reason
  );
  const against = pick.inferences.filter(
    (inf) =>
      inf.status === 'confirmed' &&
      inf.direction !== 'neutral' &&
      inf.direction !== side &&
      inf.reason
  );
  const breakdown = [...withPlay, ...against]
    .map((inf) => cleanClaimText(inf.reason))
    .filter(Boolean)
    .slice(0, 5);
  const why = withPlay[0] ? cleanClaimText(withPlay[0].reason) : '';
  const push = against[0] ? cleanClaimText(against[0].reason) : '';
  const market =
    line != null ? `${last}'s ${pick.stat_label} ${line} vs ${opp}` : `${last}'s ${pick.stat_label} vs ${opp}`;

  if (stance === 'leave') {
    return {
      answer: `I'd leave ${market} alone. The reads conflict.`,
      breakdown,
    };
  }
  if (mixed) {
    let answer = `I wouldn't force ${market}.`;
    if (why) answer += ` ${side === 'under' ? 'The under' : 'The over'} has a case — ${why.charAt(0).toLowerCase()}${why.slice(1)}`;
    if (push) answer += ` ${push.charAt(0).toLowerCase()}${push.slice(1)}`;
    return { answer, breakdown };
  }
  const taken = takeQuote(pick);
  if (taken) {
    const books = taken.quote.books.length ? ` (${taken.quote.books.join(', ')})` : '';
    const head = `I'd take ${pick.stat_label} ${taken.side} ${taken.quote.line} at ${taken.quote.price}${books}.`;
    return { answer: why ? `${head} ${why}` : head, breakdown };
  }
  const head =
    line != null
      ? `I'd lean ${last} ${side} ${line} ${pick.stat_label} vs ${opp}.`
      : `I'd lean ${last} ${side} ${pick.stat_label} vs ${opp}.`;
  return { answer: why ? `${head} ${why}` : head, breakdown };
}

function looksLikeEngineJargon(answer: string): boolean {
  return (
    /\bthe model says\b/i.test(answer) ||
    /\bno edge\b/i.test(answer) ||
    /\bverdict\b/i.test(answer) ||
    /\bAVOID\b/.test(answer) ||
    /\bSTRONG\s+(OVER|UNDER)\b/i.test(answer) ||
    /\bLEAN\s+(OVER|UNDER)\b/i.test(answer) ||
    /\bKelly\b|\bno-vig\b|\bfair price\b/i.test(answer)
  );
}

function answersTheQuestion(
  question: string,
  answer: string,
  intent: NblAskIntent,
  requestedLine?: number | null,
  takeLock?: { side: 'over' | 'under'; line: number | null; priced: boolean }
): boolean {
  if (intent === 'take' || intent === 'other_markets') {
    if (/^\s*(avoid|stay away|no edge|model:)/i.test(answer)) return false;
    if (/wouldn't force another market/i.test(answer)) return false;
    if (intent === 'other_markets') {
      return /i'?d look at|i'?d take|i'?d be on|\blook at\b/i.test(answer);
    }
    if (takeLock) {
      const rec = answer.match(/i'?d (?:take|be on) \S+ (over|under) (\d+(?:\.\d+)?)/i);
      if (rec) {
        if (rec[1] !== takeLock.side) return false;
        if (takeLock.line != null && Math.abs(Number(rec[2]) - takeLock.line) > 0.05) return false;
      }
      if (takeLock.side === 'under' && /i'?d take \S+ over/i.test(answer)) return false;
    }
    return /i'?d take|i'?d be on|\btake (?:the )?(?:over|under)\b/i.test(answer);
  }
  if (intent === 'best_line') {
    if (/\bavoid\b|\bstay away\b|\bno edge\b|\bdon'?t bet\b|\bfade\b|\blean\b|\bstrong\b/i.test(answer)) {
      return false;
    }
    const short = answer.match(/(\d+(?:\.\d+)?)\s+at\s+(1\.(?:0\d|1\d))\b/);
    if (short) {
      const line = Number(short[1]);
      const asked =
        (requestedLine != null && Math.abs(requestedLine - line) < 1e-6) ||
        question.includes(String(line));
      if (!asked) return false;
    }
    return /\bbest over\b|\bbest under\b|\bat\s+\d|main .+ line is/i.test(answer);
  }
  if (intent === 'shot') {
    if (/^\s*avoid\b/i.test(answer)) return false;
    return /% of .*makes|shot-chart #\d/i.test(answer);
  }
  if (looksLikeEngineJargon(answer)) return false;
  return /\bover\b|\bunder\b|\bi'?d\b|\bwouldn't\b|\bleave\b|\blean\b/i.test(answer);
}

function localReply(
  panel: NblEnginePanelPayload,
  intent: NblAskIntent = 'model',
  requestedLine?: number | null,
  lookup?: { playerId?: string | null; playerName?: string | null; opponent?: string | null }
): { answer: string; breakdown: string[] } {
  if (intent === 'best_line') return localBestLineReply(panel, requestedLine);
  if (intent === 'take') return localTakeReply(panel);
  if (intent === 'other_markets') return localOtherMarketsReply(panel, lookup || {});
  if (intent === 'shot') return localShotReply(panel);
  return localModelReply(panel);
}

const LENSES = [
  'hit rate versus this line',
  'last few games and streaks',
  'H2H versus current form',
  'teammates in or out',
  'minutes and usage',
  'matchup rank versus how he actually scored on tough D',
  'shot profile against this defence',
] as const;

const SYSTEM_PROMPT = `You are a supporting punter on StatTrackr chatting about this NBL matchup. Give a clear over/under opinion, then back it with the stats. You are not a prediction model.

Use ONLY facts and numbers in the STAT PACK. Never invent a stat, line, rank, sample size, percentage, or price. Never do maths. If a number is not in the pack, skip it.

How to write:
- Talk like a punter texting a mate — short, casual, opinionated.
- Vary how you open. Do not start every answer the same way.
- Never write "Here's why."
- Never say the model, model chance, model projection, predicted, edge, EV, no-vig, fair price, Kelly, NO EDGE, AVOID, STRONG, LEAN, or Verdict.
- Never quote a percent edge vs the book. A listed price is fine.
- Dig into whatever stats matter for THIS question: hit rates, last few games, H2H, teammates out, minutes, usage, matchup ranks, shot profile.
- Do not recycle the same three facts every time. If two stats disagree, say so.
- Be specific: names, numbers, opponents.
- No lock, guaranteed, or sure-thing language.
- Answer in 2 to 4 sentences. Then breakdown: 3 to 5 short sentences, each a different fact. Do not repeat the answer.
- Surname after first mention.
- Never write pack, STAT PACK, viewing, suggestedTake, stance, mixed, or field names. The punter cannot see those.

THE QUESTION IS THE SOURCE OF TRUTH. pack.hint is a guess — if it conflicts with the question, follow the question.
pack.viewing / pack.pick is the stat on the chart (often points). That is NOT automatically the answer.
pack.card is every priced market for this player this game. pack.suggestedTake is the best stored play on that card.

When they ask what you'd take, pick a prop, who you're on, if you had to bet, a quick bet, the best line AND market, or what to look into:
- One bet only. pack.suggestedTake.side and pack.suggestedTake.line are the play. Hit rates in the pack are vs THAT line.
- If suggestedTake.take has a price: "I'd take {statLabel} {side} {line} at {price} ({books})."
- If suggestedTake.take is null: "I'd be on {statLabel} {side} {line}." Say there is no {side} price. Do NOT flip to the over on a cheaper milestone (1.5 when the line is 2.5).
- Then WHY from suggestedTake.confirmed only. Pushback from suggestedTake.pushback only.
- Never recommend over 1.5 and then argue under 2.5. Never mix two lines in one take.

When they ask how you see it / what's the model / should they bet this / your lean:
- Give YOUR punter opinion on pack.viewing. Lean over, lean under, or say you wouldn't force it.
- Never mention a model or a verdict label.
- If stance is leave, say you'd leave it. If mixed, give the lean and the pushback.

When they ask best line / best price / which book — and they did NOT ask which market to play: "Best {statLabel} over is {line} at {price} ({books})" from that market. No verdict.

When they ask where he scores / shot chart: quote "X% of makes" and shot-chart #N only. Never add zone percentages. Never "X% of scoring from weak spots".

Matchup rank is ONE input. Hard defence is not an automatic under. Easy defence is not an automatic over. If he already went over against similarly tough Ds, say that.

Ranks: shot-chart #N = court Opp Def Rank (FG% allowed). PTS D / "for PTS allowed" is box-score team allowed — a different list. Never mix them. 1st = hardest.

Books: quote a price once. TAB Touch is TABtouch. Do not volunteer a milestone below 1.50 unless they named that line.

Return JSON only:
{"answer":"string","breakdown":["string","string"]}`;

async function openaiReasoning(
  key: string,
  model: string,
  question: string,
  pack: unknown,
  history: NblAskMessage[]
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
        {
          role: 'user',
          content: `This time lean on: ${LENSES[Math.floor(Math.random() * LENSES.length)]}.\n\nSTAT PACK:\n${JSON.stringify(pack)}\n\nQUESTION (answer this, not the previous chat):\n${question}`,
        },
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

export function loadNblAskPanel(opts: {
  playerId?: string | null;
  playerName?: string | null;
  opponent?: string | null;
  stat?: string | null;
  question?: string | null;
}): NblEnginePanelPayload {
  const intent = opts.question ? nblQuestionIntent(opts.question) : 'model';
  const named = opts.question ? matchStatFromQuestion(opts.question, '') : '';
  const stat =
    named ||
    (intent === 'take' && !named ? NBL_ASK_BEST_PLAY_STAT : '') ||
    ((intent === 'best_line' || intent === 'other_markets') && opts.stat ? opts.stat : '') ||
    'points';
  return findNblEnginePanel({
    playerId: opts.playerId || null,
    playerName: opts.playerName || null,
    opponent: opts.opponent && opts.opponent !== 'All' ? opts.opponent : null,
    stat,
  });
}

export async function answerNblAsk(opts: {
  question: string;
  playerId?: string | null;
  playerName?: string | null;
  opponent?: string | null;
  stat?: string | null;
  selectedLine?: number | null;
  history?: NblAskMessage[];
  allowLlm?: boolean;
}): Promise<NblAskReply> {
  const intent = nblQuestionIntent(opts.question);
  const panel = loadNblAskPanel(opts);
  const suggestions = nblAskSuggestions(panel, opts.playerName);
  const requestedLine =
    lineNamedInQuestion(opts.question, postedLines(panel.pick)) ??
    (intent === 'best_line' &&
    opts.selectedLine != null &&
    Number.isFinite(Number(opts.selectedLine))
      ? Number(opts.selectedLine)
      : null);
  const local = localReply(panel, intent, requestedLine, opts);
  const base = { suggestions, reason: panel.reason };
  if (opts.allowLlm === false) {
    return { ...local, source: 'stats', ...base };
  }
  const canLlm = Boolean(panel.pick);
  if (!canLlm) {
    return { ...local, source: 'stats', ...base };
  }
  const cfg = llmConfigured();
  if (!cfg) return { ...local, source: 'stats', ...base };
  const takeLock = panel.pick
    ? {
        side: leanSide(panel.pick),
        line: panel.pick.line,
        priced: Boolean(takeQuote(panel.pick)),
      }
    : undefined;
  const pack = buildPack(panel, intent, requestedLine);
  try {
    const raw = await openaiReasoning(cfg.key, cfg.model, opts.question, pack, opts.history || []);
    const parsed = parseAskReply(raw);
    if (!parsed.answer) return { ...local, source: 'stats', ...base };
    const extra = inventedNumbers(`${parsed.answer}\n${parsed.breakdown.join('\n')}`, pack);
    if (extra.length) return { ...local, source: 'stats', ...base };
    if (!answersTheQuestion(opts.question, parsed.answer, intent, requestedLine, takeLock)) {
      return { ...local, source: 'stats', ...base };
    }
    return {
      answer: parsed.answer,
      breakdown: parsed.breakdown.length ? parsed.breakdown : local.breakdown,
      source: 'model',
      ...base,
    };
  } catch {
    return { ...local, source: 'stats', ...base };
  }
}
