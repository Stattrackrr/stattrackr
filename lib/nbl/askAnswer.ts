/**
 * NBL ask AI. Same shared brain as tennis (lib/ai/ask): the pack is built from the player's real
 * game logs plus the engine's stored prices and reasons; only the NBL rules and facts differ.
 */

import { askPriceCheck, type AskPriceOffer } from '@/lib/ai/ask/guards';
import { askLlmConfig, askReplyText, type AskMessage, type AskReplyText } from '@/lib/ai/ask/llm';
import { buildAskSystemPrompt, buildAskUserContent } from '@/lib/ai/ask/rules';
import { runAskAi } from '@/lib/ai/ask/run';
import {
  nblHeadToHead,
  nblInjuriesFor,
  nblLineRead,
  nblPlayerForm,
  nblStatFromQuestion,
  NBL_ASK_STAT_WORDS,
  type NblLineRead,
} from '@/lib/nbl/askAnalysis';
import { nblPunterQuestions } from '@/lib/nbl/askSuggestions';
import {
  findNblEnginePanel,
  findNblEnginePlayerPicks,
  NBL_ASK_BEST_PLAY_STAT,
  nblClubCodeFor,
  rankNblPlayPicks,
  selectNblAskPick,
} from '@/lib/nbl/enginePicks';
import {
  NBL_MIN_MODEL_DECIMAL,
  nblStoredLineQuotes,
  type NblEnginePanelPayload,
  type NblEnginePick,
} from '@/lib/nbl/engineShared';
import { loadNblPlayerGameLogs } from '@/lib/nbl/playerGameLogsServer';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { getNblClubByCode, NBL_CHART_HISTORY_YEARS } from '@/lib/nblTeamCanonical';

export type NblAskMessage = AskMessage;
export type NblAskReply = {
  answer: string;
  breakdown: string[];
  source: 'model' | 'stats';
  suggestions: string[];
  reason: string | null;
};

export function nblAskConfigured(): boolean {
  return askLlmConfig(process.env.NBL_ASK_MODEL) != null;
}

function clubName(code: string | null | undefined): string {
  if (!code) return '';
  return getNblClubByCode(code)?.name || code;
}

/** "Gary Payton Jr." -> "Payton". */
function lastNameOf(name: string | null | undefined): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && /^(?:jr|sr|ii|iii|iv|v)\.?$/i.test(parts.at(-1)!)) parts.pop();
  return parts.at(-1) || String(name || '');
}

function statWords(stat: string): string {
  return NBL_ASK_STAT_WORDS[stat] ?? stat;
}

/** Engine reason text uses stat codes; the punter sees plain words. */
function plainWords(text: string): string {
  return String(text || '')
    .replace(/\(\s*box score, not a shot-chart zone rank\.?\s*\)/gi, '')
    .replace(/\s*box score, not a shot-chart zone rank\.?/gi, '')
    .replace(/\s*One input among many[^.]*\./gi, '')
    .replace(/\bPRA\b/g, 'points + rebounds + assists')
    .replace(/\bPTS D\b/g, 'points-allowed defence')
    .replace(/\bFGA\b/g, 'field goal attempts')
    .replace(/\bFG%/g, 'field goal %')
    .replace(/\bPTS\b/g, 'points')
    .replace(/\bREB\b/g, 'rebounds')
    .replace(/\bAST\b/g, 'assists')
    .replace(/\b3PM\b/g, 'threes made')
    .replace(/\bH2H\b/g, 'head to head')
    .replace(/\bL(5|10|15)\b/g, 'last $1')
    .replace(/\bgame\(s\)/g, 'games')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

function firstSentence(text: string): string {
  const cleaned = plainWords(text);
  const sentence = cleaned.match(/^.+?[.](?=\s|$)/);
  return (sentence ? sentence[0] : cleaned).trim();
}

function leanSide(pick: NblEnginePick): 'over' | 'under' {
  if (pick.side === 'over' || pick.side === 'under') return pick.side;
  return pick.score_over >= pick.score_under ? 'over' : 'under';
}

export type NblAskIntent = 'take' | 'other_markets' | 'best_line' | 'shot' | 'model';

export function nblQuestionIntent(question: string): NblAskIntent {
  const q = question.toLowerCase();
  if (/\bwhere does\b|\bscore from\b|\bshot chart\b|\bfrom against\b/.test(q)) return 'shot';
  if (/\bhow do you see\b|\bwhat(?:'s| is) the (?:model|lean)\b/.test(q)) return 'model';

  // "Best line for Cooks" is his best bet on any market; "best points line" or "best price" stays a price quote.
  if (/\bbest (?:line|bet|play|prop|market|pick)s?\b/.test(q) && !/\bprices?\b|\bbooks?\b|\bbookies?\b/.test(q) && !nblStatFromQuestion(q)) {
    return 'take';
  }

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
    /\bbest line\b|\bbest (?:[a-z+']+ ){1,3}line\b|\bbest price\b|\bwhich book|\bbookies?\b/.test(q) ||
    /\bline to (take|bet)\b|\btake to bet\b|\bwhat(?:'s| is) the line\b|\bwhich line\b|\bwhat line\b/.test(q) ||
    /\bbest over\b|\bbest under\b|\bwhere to take\b|\bwhat to take\b|\bwhich number\b/.test(q)
  ) {
    return 'best_line';
  }
  return 'model';
}

export function loadNblAskPanel(opts: {
  playerId?: string | null;
  playerName?: string | null;
  opponent?: string | null;
  stat?: string | null;
  question?: string | null;
}): NblEnginePanelPayload {
  const intent = opts.question ? nblQuestionIntent(opts.question) : 'model';
  const named = opts.question ? nblStatFromQuestion(opts.question) : null;
  const stat =
    named ||
    (intent === 'take' ? NBL_ASK_BEST_PLAY_STAT : '') ||
    ((intent === 'best_line' || intent === 'other_markets') && opts.stat ? opts.stat : '') ||
    'points';
  return findNblEnginePanel({
    playerId: opts.playerId || null,
    playerName: opts.playerName || null,
    opponent: opts.opponent && opts.opponent !== 'All' ? opts.opponent : null,
    stat,
  });
}

export function nblAskSuggestions(panel: NblEnginePanelPayload, playerName?: string | null): string[] {
  const player = playerName || panel.pick?.player_name || '';
  const opp = clubName(panel.game?.opponent_code) || '';
  return nblPunterQuestions(player, opp);
}

type Quote = { line: number; price: number; books: string[] };

function priceText(q: Quote): string {
  const books = q.books.length ? ` (${q.books.join(', ')})` : '';
  return `${q.price}${books}`;
}

function takeQuote(pick: NblEnginePick): { side: 'over' | 'under'; quote: Quote } | null {
  const side = leanSide(pick);
  const quotes = nblStoredLineQuotes(pick, { atLine: pick.line });
  const quote = side === 'over' ? quotes.bestOver : quotes.bestUnder;
  return quote && quote.price >= NBL_MIN_MODEL_DECIMAL - 1e-9 ? { side, quote } : null;
}

/** "20+ points" is over 19.5; "over 9.5" or a bare 9.5 is the line itself. */
function lineFromQuestion(question: string): number | null {
  const plus = question.match(/(?<![\d.])(\d{1,2})\s*\+/);
  if (plus) return Number(plus[1]) - 0.5;
  const half = question.match(/(?<![\d.])(\d{1,2}\.5)(?![\d])/);
  if (half) return Number(half[1]);
  const ou = question.match(/\b(?:over|under|o|u)\s*(\d{1,2}(?:\.\d)?)\b/i);
  return ou ? Number(ou[1]) : null;
}

type RankedBet = {
  pick: NblEnginePick;
  side: 'over' | 'under';
  quote: Quote;
  read: NblLineRead;
  score: number;
};

type NblAskContext = {
  question: string;
  intent: NblAskIntent;
  panel: NblEnginePanelPayload;
  games: NblGameLogRow[];
  player: string;
  last: string;
  teamCode: string | null;
  opponentCode: string | null;
  stat: string;
  line: number | null;
  lineFromUser: boolean;
  read: NblLineRead | null;
  cardPicks: NblEnginePick[];
  ranked: RankedBet[];
};

function readFor(ctx: NblAskContext, stat: string, line: number | null): NblLineRead | null {
  return line == null ? null : nblLineRead(ctx.games, stat, line, ctx.opponentCode);
}

const RECORD_WEIGHTS = { last5: 0.15, last10: 0.3, last15: 0.15, season: 0.2, against: 0.2 } as const;
const MIN_LIKED_RECORD = 0.55;

/** Weighted share of games that landed on this side of the line across his recent, season and head-to-head windows. */
function sideRecord(read: NblLineRead, side: 'over' | 'under'): number | null {
  let total = 0;
  let weight = 0;
  for (const w of read.windows) {
    if (!w.games) continue;
    const key = w.window.startsWith('against ')
      ? 'against'
      : w.window === 'this season'
        ? 'season'
        : w.games <= 5
          ? 'last5'
          : w.games <= 10
            ? 'last10'
            : 'last15';
    if ((key === 'against' || key === 'season') && w.games < 3) continue;
    total += RECORD_WEIGHTS[key] * ((side === 'over' ? w.overs : w.unders) / w.games);
    weight += RECORD_WEIGHTS[key];
  }
  return weight ? total / weight : null;
}

/** Records within 5% count as level, then the bigger price wins, so the same data always ranks the same way. */
function byBet(a: RankedBet, b: RankedBet): number {
  return (
    Math.round(b.score * 20) - Math.round(a.score * 20) ||
    b.quote.price - a.quote.price ||
    b.quote.books.length - a.quote.books.length ||
    b.score - a.score
  );
}

/** His best priced line per market (1.50 or more, side backed by his record), best first. */
function rankBets(ctx: NblAskContext): RankedBet[] {
  const best = new Map<string, RankedBet>();
  for (const pick of ctx.cardPicks) {
    const lines = [...new Set((pick.line_summary?.book_lines || []).map((row) => row.line))];
    for (const line of lines) {
      const read = readFor(ctx, pick.stat, line);
      if (!read || !read.windows.some((w) => w.window.startsWith('last ') && w.games >= 4)) continue;
      const quotes = nblStoredLineQuotes(pick, { atLine: line });
      for (const side of ['over', 'under'] as const) {
        const quote = side === 'over' ? quotes.bestOver : quotes.bestUnder;
        if (!isFairPrice(quote)) continue;
        const score = sideRecord(read, side);
        if (score == null || score < MIN_LIKED_RECORD) continue;
        const bet: RankedBet = { pick, side, quote, read, score };
        const prev = best.get(pick.stat);
        if (!prev || byBet(bet, prev) < 0) best.set(pick.stat, bet);
      }
    }
  }
  return [...best.values()].sort(byBet);
}

function betText(ctx: NblAskContext, bet: RankedBet): string {
  return `${ctx.last} ${bet.read.statWords} ${bet.side} ${bet.quote.line} at ${priceText(bet.quote)}`;
}

function betRecordLine(ctx: NblAskContext, bet: RankedBet): string | null {
  const recent = recentWindow(bet.read);
  if (!recent) return null;
  const hits = bet.side === 'over' ? recent.overs : recent.unders;
  const vs = bet.read.windows.find((w) => w.window.startsWith('against '));
  const vsText = vs && vs.games >= 3 ? `, and ${bet.side === 'over' ? vs.overs : vs.unders} of ${vs.games} ${vs.window}` : '';
  return `${bet.read.statWords} ${bet.side} ${bet.quote.line}: ${hits} of his ${recent.window}${vsText}.`;
}

/** The last-10 window, or the biggest recent one when he has played fewer games. */
function recentWindow(read: NblLineRead | null) {
  const recent = (read?.windows || []).filter((w) => w.window.startsWith('last ') && w.games <= 10);
  return recent.at(-1) ?? null;
}

function logBreakdown(ctx: NblAskContext, read: NblLineRead | null): string[] {
  const lines: string[] = [];
  const form = nblPlayerForm(ctx.games, read?.stat ?? ctx.stat);
  if (read) {
    const recent = recentWindow(read);
    if (recent) lines.push(`${ctx.last} has gone over ${read.line} ${read.statWords} in ${recent.overs} of his ${recent.window}.`);
    const season = read.windows.find((w) => w.window === 'this season');
    if (season && season.games >= 3 && season.games !== recent?.games) {
      lines.push(`This season it is ${season.overs} of ${season.games}, averaging ${season.average} ${read.statWords}.`);
    }
    if (read.run) lines.push(`He has gone ${read.run}.`);
    const vs = read.windows.find((w) => w.window.startsWith('against '));
    if (vs) {
      const h2h = nblHeadToHead(ctx.games, ctx.opponentCode, read.stat);
      const when = h2h.lastMeeting ? `, the last one ${h2h.lastMeeting}` : '';
      lines.push(`${vs.window.replace(/^against/, 'Against')} he has gone over in ${vs.overs} of ${vs.games}${when}.`);
    }
  }
  const minutes = form.averages.last5.minutes;
  const seasonMinutes = form.averages.thisSeason.minutes;
  if (minutes != null && seasonMinutes != null) {
    lines.push(`He is playing ${minutes} minutes over his last 5, against ${seasonMinutes} for the season.`);
  }
  const injuries = nblInjuriesFor(ctx.teamCode, ctx.opponentCode, ctx.player);
  if (injuries.teammatesOut.length) {
    lines.push(`Teammates out: ${injuries.teammatesOut.map((row) => row.player).join(', ')}.`);
  }
  return lines.slice(0, 6);
}

function engineReasons(pick: NblEnginePick, side: 'over' | 'under') {
  const confirmed = pick.inferences.filter((inf) => inf.status === 'confirmed' && inf.reason);
  return {
    for: confirmed.filter((inf) => inf.direction === side).map((inf) => firstSentence(inf.reason)),
    against: confirmed
      .filter((inf) => inf.direction !== 'neutral' && inf.direction !== side)
      .map((inf) => firstSentence(inf.reason)),
  };
}

function localBestLineReply(ctx: NblAskContext): AskReplyText {
  const pick = ctx.panel.pick;
  const stored = pick ? nblStoredLineQuotes(pick, { atLine: ctx.lineFromUser ? ctx.line : null }) : null;
  const focus = ctx.panel.markets.find((m) => m.stat === pick?.stat) ?? ctx.panel.markets[0];
  const over = stored?.bestOver || focus?.bestOver;
  const under = stored?.bestUnder || focus?.bestUnder;
  const words = statWords(focus?.stat || pick?.stat || ctx.stat);
  if (!over && !under) {
    return { answer: ctx.panel.reason || `No ${words} price was on the board when the lines were last checked.`, breakdown: [] };
  }
  const parts = [
    over ? `Best over price for ${ctx.last}'s ${words} is ${over.line} at ${priceText(over)}.` : null,
    under && (!over || under.line !== over.line || under.price !== over.price)
      ? `Best under is ${under.line} at ${priceText(under)}.`
      : null,
  ].filter(Boolean);
  const view = localModelReply(ctx);
  return { answer: `${parts.join(' ')} ${view.answer}`, breakdown: view.breakdown };
}

function localTakeReply(ctx: NblAskContext): AskReplyText {
  const [top, next] = ctx.ranked;
  if (top) {
    const also = next ? ` I also like ${betText(ctx, next)}.` : '';
    return {
      answer: `I'd take ${betText(ctx, top)}.${also}`,
      breakdown: [top, next]
        .filter((bet): bet is RankedBet => Boolean(bet))
        .map((bet) => betRecordLine(ctx, bet))
        .filter((line): line is string => Boolean(line)),
    };
  }
  const pick =
    rankNblPlayPicks(ctx.cardPicks).find((p) => takeQuote(p)) ?? selectNblAskPick(ctx.cardPicks) ?? ctx.panel.pick;
  if (!pick) return localModelReply(ctx);
  const taken = takeQuote(pick);
  const side = leanSide(pick);
  const read = readFor(ctx, pick.stat, taken?.quote.line ?? pick.line);
  const reasons = engineReasons(pick, side);
  const breakdown = [...logBreakdown(ctx, read), ...reasons.for.slice(0, 1)].slice(0, 6);
  if (taken) {
    return {
      answer: `I'd take ${ctx.last} ${statWords(pick.stat)} ${taken.side} ${taken.quote.line} at ${priceText(taken.quote)}.`,
      breakdown,
    };
  }
  return {
    answer:
      pick.line != null
        ? tooShortSides(pick).includes(`${side} ${pick.line}`)
          ? `I'd be on ${ctx.last} ${statWords(pick.stat)} ${side} ${pick.line}, but the price is too short to bet.`
          : `I'd be on ${ctx.last} ${statWords(pick.stat)} ${side} ${pick.line}, but there is no ${side} price on the board.`
        : `No ${statWords(pick.stat)} price is on the board for ${ctx.last}.`,
    breakdown,
  };
}

function localOtherMarketsReply(ctx: NblAskContext): AskReplyText {
  const skip = ctx.panel.pick?.stat || ctx.stat;
  const ranked = rankNblPlayPicks(ctx.cardPicks.filter((p) => p.stat !== skip));
  const others = ranked.slice(0, 3);
  if (!others.length) {
    return { answer: `No other priced market besides ${statWords(skip)} is on the board for ${ctx.last}.`, breakdown: [] };
  }
  const describe = (pick: NblEnginePick) => {
    const taken = takeQuote(pick);
    if (!taken) return null;
    const l10 = recentWindow(readFor(ctx, pick.stat, taken.quote.line));
    const hit = l10 ? ` He has gone ${taken.side} in ${taken.side === 'over' ? l10.overs : l10.unders} of his last ${l10.games}.` : '';
    return `${statWords(pick.stat)} ${taken.side} ${taken.quote.line} at ${priceText(taken.quote)}.${hit}`;
  };
  const rows = others.map(describe).filter((row): row is string => Boolean(row));
  if (!rows.length) {
    return { answer: `No other priced market besides ${statWords(skip)} is on the board for ${ctx.last}.`, breakdown: [] };
  }
  return { answer: `I'd look at ${ctx.last} ${rows[0]}`, breakdown: rows.slice(1) };
}

function localShotReply(ctx: NblAskContext): AskReplyText {
  const pick = ctx.panel.pick;
  if (!pick) return { answer: ctx.panel.reason || 'No shot profile stored for this matchup.', breakdown: [] };
  const shares = pick.claims.filter((c) => String(c.metric || '').startsWith('zone_share_'));
  const ranks = pick.claims.filter((c) => String(c.metric || '').startsWith('opp_zone_rank_'));
  const edge = pick.claims.find((c) => c.metric === 'zone_matchup_edge');
  return {
    answer: plainWords(shares[0]?.as_text || edge?.as_text || pick.narrative),
    breakdown: [...shares.slice(1), ...ranks, edge]
      .filter(Boolean)
      .map((c) => plainWords(c!.as_text))
      .slice(0, 5),
  };
}

function localModelReply(ctx: NblAskContext): AskReplyText {
  const pick = ctx.panel.pick && ctx.panel.pick.stat === ctx.stat ? ctx.panel.pick : null;
  const read = ctx.read;
  const words = statWords(ctx.stat);
  const opp = clubName(ctx.opponentCode);
  const breakdown = logBreakdown(ctx, read);
  if (!read) {
    return {
      answer: ctx.panel.reason || `There is no ${words} line on the board for ${ctx.last} against ${opp} yet.`,
      breakdown,
    };
  }
  const l10 = recentWindow(read);
  const fromLogs: 'over' | 'under' | null = l10 && l10.games >= 4
    ? l10.overs / l10.games >= 0.6
      ? 'over'
      : l10.unders / l10.games >= 0.6
        ? 'under'
        : null
    : null;
  const engine = pick && pick.tier !== 'AVOID' && pick.tier !== 'NO EDGE' && pick.line === read.line ? leanSide(pick) : null;
  const side = engine ?? fromLogs;
  const market = `${ctx.last} ${words} ${read.line} against ${opp}`;
  if (!side || (engine && fromLogs && engine !== fromLogs)) {
    return { answer: `I wouldn't force ${market}. The numbers point both ways.`, breakdown };
  }
  const quote = pick ? nblStoredLineQuotes(pick, { atLine: read.line }) : null;
  const price = side === 'over' ? quote?.bestOver : quote?.bestUnder;
  const head = price
    ? `I'd lean ${ctx.last} ${side} ${read.line} ${words} at ${priceText(price)}.`
    : `I'd lean ${ctx.last} ${side} ${read.line} ${words}.`;
  const why = l10 ? ` He has gone ${side} in ${side === 'over' ? l10.overs : l10.unders} of his last ${l10.games}.` : '';
  return { answer: `${head}${why}`, breakdown };
}

function localReply(ctx: NblAskContext): AskReplyText {
  if (ctx.intent === 'best_line') return localBestLineReply(ctx);
  if (ctx.intent === 'take') return localTakeReply(ctx);
  if (ctx.intent === 'other_markets') return localOtherMarketsReply(ctx);
  if (ctx.intent === 'shot') return localShotReply(ctx);
  return localModelReply(ctx);
}

const MATCHUP_GROUPS: Array<{ key: string; test: (c: NblEnginePick['claims'][number]) => boolean }> = [
  { key: 'opponentDefence', test: (c) => c.category === 'matchup_allowed' },
  { key: 'versusToughAndEasyDefences', test: (c) => c.metric === 'season_vs_d_hits' || c.metric === 'season_slate' },
  { key: 'pace', test: (c) => c.category === 'pace' && c.metric === 'opp_pace' },
  { key: 'withAndWithoutInjuredTeammates', test: (c) => c.category === 'injury_impact' || c.metric === 'teammate_out' },
  { key: 'usageAndShots', test: (c) => c.category === 'usage' },
  { key: 'minutes', test: (c) => c.category === 'minutes' },
  { key: 'homeAway', test: (c) => c.category === 'home_away' },
  { key: 'headToHeadBySeason', test: (c) => /^h2h_mean_\d{4}$/.test(c.metric) || c.metric === 'h2h_minutes_vs_now' },
  { key: 'rest', test: (c) => c.metric === 'rest_days' },
];

/** The engine's matchup facts for one market, grouped and in plain words. */
function matchupFacts(pick: NblEnginePick | null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!pick) return out;
  for (const group of MATCHUP_GROUPS) {
    const rows = pick.claims.filter(group.test).map((c) => plainWords(c.as_text)).filter(Boolean);
    if (rows.length) out[group.key] = [...new Set(rows)];
  }
  return out;
}

function isFairPrice(q: Quote | null | undefined): q is Quote {
  return Boolean(q && q.price >= NBL_MIN_MODEL_DECIMAL - 1e-9);
}

/** Every line the books offer on this market (milestone ladders included), fair prices only, with his hit rates there. */
function lineLadder(ctx: NblAskContext, pick: NblEnginePick) {
  const lines = [...new Set((pick.line_summary?.book_lines || []).map((row) => row.line))].sort((a, b) => a - b);
  return lines.flatMap((line) => {
    const q = nblStoredLineQuotes(pick, { atLine: line });
    const over = isFairPrice(q.bestOver) ? q.bestOver : null;
    const under = isFairPrice(q.bestUnder) ? q.bestUnder : null;
    if (!over && !under) return [];
    return [{ line, over, under, hitRates: readFor(ctx, pick.stat, line)?.windows ?? [] }];
  });
}

function tooShortSides(pick: NblEnginePick): string[] {
  if (pick.line == null) return [];
  const q = nblStoredLineQuotes(pick, { atLine: pick.line });
  return (['over', 'under'] as const)
    .filter((side) => {
      const quote = side === 'over' ? q.bestOver : q.bestUnder;
      return quote != null && !isFairPrice(quote);
    })
    .map((side) => `${side} ${pick.line}`);
}

/** Milestone-only markets (10+ and so on) have no under to bet; these are the under lines worth waiting for, with his hit rates. */
function waitForUnder(ctx: NblAskContext, pick: NblEnginePick | null) {
  const rows = pick?.line_summary?.book_lines || [];
  if (!pick || pick.line == null || !rows.length || rows.some((row) => row.under_decimal != null)) return null;
  if (leanSide(pick) !== 'under') return null;
  return [pick.line, pick.line + 1, pick.line + 2].map((line) => {
    const read = readFor(ctx, pick.stat, line);
    return { line, hitRates: read?.windows ?? [], run: read?.run ?? null };
  });
}

function marketRow(ctx: NblAskContext, pick: NblEnginePick) {
  const quotes = nblStoredLineQuotes(pick);
  const side = leanSide(pick);
  const taken = takeQuote(pick);
  const read = readFor(ctx, pick.stat, pick.line);
  const reasons = engineReasons(pick, side);
  return {
    market: statWords(pick.stat),
    line: pick.line,
    lean: side,
    leanStrength: pick.tier === 'STRONG' ? 'firm' : pick.tier === 'LEAN' ? 'mild' : 'none',
    bestOver: quotes.bestOver,
    bestUnder: quotes.bestUnder,
    priceForLean: taken ? taken.quote : null,
    hitRates: read?.windows ?? [],
    reasonsFor: reasons.for,
    reasonsAgainst: reasons.against,
    opponentDefence: matchupFacts(pick).opponentDefence ?? [],
    otherLines: lineLadder(ctx, pick).filter((row) => row.line !== pick.line),
    tooShortToBet: tooShortSides(pick),
    waitForUnder: waitForUnder(ctx, pick),
  };
}

function buildPack(ctx: NblAskContext) {
  const form = nblPlayerForm(ctx.games, ctx.stat);
  const focusPick = ctx.cardPicks.find((p) => p.stat === ctx.stat) ?? null;
  const quotes = focusPick ? nblStoredLineQuotes(focusPick, { atLine: ctx.line }) : null;
  const fair = (q: Quote | null | undefined) => (q && (ctx.lineFromUser || isFairPrice(q)) ? q : null);
  const best = selectNblAskPick(ctx.cardPicks);
  return {
    game: {
      label: ctx.panel.game?.game_label ?? null,
      player: ctx.player,
      team: clubName(ctx.teamCode),
      opponent: clubName(ctx.opponentCode),
      home: ctx.panel.game?.is_home ?? null,
    },
    player: {
      name: ctx.player,
      pronouns: 'he / him / his / himself',
      gamesThisSeason: form.gamesThisSeason,
      averages: form.averages,
      lastGames: form.lastGames,
    },
    focus: {
      market: statWords(ctx.stat),
      line: ctx.line,
      lineIs: ctx.lineFromUser ? 'the number the user named' : 'the book line on the chart',
      hitRates: ctx.read?.windows ?? [],
      run: ctx.read?.run ?? null,
      bestOver: fair(quotes?.bestOver),
      bestUnder: fair(quotes?.bestUnder),
      lean: focusPick ? leanSide(focusPick) : null,
      leanStrength: focusPick ? (focusPick.tier === 'STRONG' ? 'firm' : focusPick.tier === 'LEAN' ? 'mild' : 'none') : null,
      reasonsFor: focusPick ? engineReasons(focusPick, leanSide(focusPick)).for : [],
      reasonsAgainst: focusPick ? engineReasons(focusPick, leanSide(focusPick)).against : [],
      matchup: matchupFacts(focusPick),
      waitForUnder: waitForUnder(ctx, focusPick),
    },
    userLine: ctx.lineFromUser && ctx.read ? { market: ctx.read.statWords, line: ctx.read.line, hitRates: ctx.read.windows, run: ctx.read.run } : null,
    timeline: form.timeline,
    h2h: nblHeadToHead(ctx.games, ctx.opponentCode, ctx.stat),
    rankedBets: ctx.ranked.slice(0, 3).map((bet, i) => ({
      rank: i + 1,
      market: bet.read.statWords,
      side: bet.side,
      line: bet.quote.line,
      price: bet.quote.price,
      books: bet.quote.books,
      hitRates: bet.read.windows,
      run: bet.read.run,
      reasonsFor: engineReasons(bet.pick, bet.side).for,
      reasonsAgainst: engineReasons(bet.pick, bet.side).against,
      opponentDefence: matchupFacts(bet.pick).opponentDefence ?? [],
    })),
    markets: ctx.cardPicks.map((pick) => marketRow(ctx, pick)),
    bestPricedPlay: best ? { market: statWords(best.stat), side: leanSide(best), line: best.line, price: takeQuote(best)?.quote ?? null } : null,
    injuries: nblInjuriesFor(ctx.teamCode, ctx.opponentCode, ctx.player),
    shotProfile: (ctx.panel.pick?.claims || [])
      .filter((c) => /^(zone_share_|opp_zone_rank_|zone_matchup_edge)/.test(String(c.metric || '')))
      .map((c) => plainWords(c.as_text))
      .slice(0, 6),
  };
}

const LENSES = [
  'hit rate versus this line',
  'last few games and streaks',
  'head to head versus current form',
  'teammates in or out',
  'minutes and role',
  'how the matchup compares with how he has actually gone against tough defences',
  'shot profile against this defence',
] as const;

const NBL_RULES = `NBL basketball:
- No stat codes like PTS, REB, AST, 3PM, PRA, P+R, L5, L10, H2H, DNP or USG — write "points", "rebounds", "assists", "threes made", "points + rebounds + assists", "last 10", "head to head".
- Stats that matter: hit rates against the line (last 5, last 10, last 15, this season, against this opponent), over/under runs, averages, minutes and role, teammates out, head to head with how long ago, matchup and pace.
- focus is the market on the chart. focus.line is the book line unless the user named a number — then grade userLine first.
- Think like a punter sizing up a matchup: put his numbers beside what this opponent gives up. focus.matchup has what the defence allows and its rank, how he has gone against tough and easy defences, his numbers with and without the injured teammates, usage and shots, minutes, home and away, head to head by season, and rest. The best answers weigh his form against the matchup and the role change, not just a hit rate.
- With and without teammates matters most when those teammates are out tonight — say how his numbers move without them.
- Hit rates are overs and unders at that exact line, like "over 9.5 points in 6 of his last 10 games". A push (landing exactly on a whole-number line) is neither.
- markets is every priced market for him this game. When they want a bet and rankedBets is filled, use rankedBets in its order. Otherwise choose from markets with a price; bestPricedPlay is the strongest priced read on his card — prefer it unless his game logs clearly disagree, and if they do, say why.
- Each market's lean and reasons are one read among the stats, not a must. If his logs disagree, say so.
- Milestone markets (2+, 10+ and so on) only offer the over. When his numbers back the under there (waitForUnder is filled in), you cannot bet the milestone, but you can say you would wait and take an under line from waitForUnder if one goes up, e.g. "I'd wait and take under 12.5", then give his under record at that line (not the milestone line). Pick the waitForUnder line whose hit rates back the under best. When you lean under on a milestone market, this beats a bare pass. Say there is no under price yet and never make one up.
- Do not volunteer a price under 1.50 unless they named that line. Quote a price once. TAB Touch is TABtouch.
- Ranks: shot-chart #N is the zone rank on the court (field goal % allowed). "Points allowed" ranks are box-score team allowed — a different list. Never mix them. 1st is the hardest defence; for pace, 1st is the slowest.
- Matchup rank is one input. A hard defence is not an automatic under, an easy one is not an automatic over.
- Injuries: only name players listed in injuries. Never guess return dates beyond what is listed.
- Shot chart questions: quote "X% of makes" and shot-chart #N from shotProfile only.
- NBL players are men: he / him.`;

const SYSTEM_PROMPT = buildAskSystemPrompt({ subject: 'this NBL game', sportRules: NBL_RULES });

function priceOffers(picks: NblEnginePick[]): AskPriceOffer[] {
  const offers: AskPriceOffer[] = [];
  for (const pick of picks) {
    for (const row of pick.line_summary?.book_lines || []) {
      if (row.over_decimal != null) offers.push({ side: 'over', line: row.line, price: row.over_decimal });
      if (row.under_decimal != null) offers.push({ side: 'under', line: row.line, price: row.under_decimal });
    }
  }
  return offers;
}

function locksFor(ctx: NblAskContext): string[] {
  const words = statWords(ctx.stat);
  const locks = [
    ctx.lineFromUser && ctx.line != null
      ? `The user named ${ctx.line} ${words} for ${ctx.last}. Grade that number with his hit rates at ${ctx.line}.`
      : ctx.line != null
        ? `The chart is on ${ctx.last} ${words}, book line ${ctx.line}.`
        : `No book line for ${ctx.last} ${words} — talk about his form and say there is no line.`,
  ];
  if (ctx.intent === 'take' && ctx.ranked.length) {
    const [top, next] = ctx.ranked;
    locks.push(
      `They want THE best bet on ${ctx.last}, on any market. rankedBets is already ranked on his record at each line, priced ${NBL_MIN_MODEL_DECIMAL.toFixed(2)} or more. Lead with rank 1: "I'd take ${betText(ctx, top)}" and the main reason.${
        next ? ` Then a sentence starting "I also like" with rank 2: ${betText(ctx, next)}, and its reason.` : ''
      } Keep this order and these exact lines and prices. Breakdown: his record at each of those lines first, then the matchup facts that back them. Never quote a price under ${NBL_MIN_MODEL_DECIMAL.toFixed(2)}.`
    );
  } else if (ctx.intent === 'take') {
    locks.push(
      `They want THE best bet on ${ctx.last}, on any market — points, rebounds, assists, threes made or a combo, not just the chart. Weigh every row in markets, including each market's otherLines (alternative lines like 3+ or 4+ with their own prices and hit rates). Only prices of ${NBL_MIN_MODEL_DECIMAL.toFixed(2)} or more are listed. Pick the market, line and side where his hit rates at that line and the matchup most clearly back it — a higher line at a fair price often beats a short main line. Name the market, side, line, price and book, then the main reasons. Never quote a price under ${NBL_MIN_MODEL_DECIMAL.toFixed(2)}; tooShortToBet sides are priced but too short — call them too short, never "no price". If the side his numbers back has no price, pick another market, or on a milestone market say you would wait for an under line from waitForUnder — never take the opposite side because it has a price. Prefer a priced bet when one is solid; waiting for an under is fine when that under is clearly the strongest read. If nothing is worth a bet, say you would pass and name the one closest to a bet.`
    );
  }
  if (ctx.intent === 'other_markets') locks.push(`They want a market other than ${words}. Pick from the rest of markets.`);
  if (ctx.intent === 'best_line') {
    locks.push(
      'They asked for the best line. Lead with the best over and under price and book for that market, then say which side you would take or that you would pass, and the main reason why. If you lean under and there is no under price (focus.waitForUnder is filled), say which under line you would wait for instead of just passing, and lead the breakdown with his under record at THAT line from waitForUnder.'
    );
  }
  locks.push(`${ctx.last} is a man. Refer to him as he / him / his.`);
  return locks;
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
  startedAt?: number;
}): Promise<NblAskReply> {
  const intent = nblQuestionIntent(opts.question);
  const panel = loadNblAskPanel(opts);
  const suggestions = nblAskSuggestions(panel, opts.playerName);
  const base = { suggestions, reason: panel.reason };
  const playerId = opts.playerId || panel.pick?.player_id || null;
  const logs = loadNblPlayerGameLogs({ playerId, name: playerId ? null : opts.playerName, years: [...NBL_CHART_HISTORY_YEARS] });
  const games = logs?.games ?? [];
  const player = panel.pick?.player_name || logs?.name || opts.playerName || '';
  const cardPicks = findNblEnginePlayerPicks({
    playerId,
    playerName: player || null,
    opponent: panel.game?.opponent_code || opts.opponent || null,
  });
  const opponentCode = panel.game?.opponent_code || nblClubCodeFor(opts.opponent);
  const teamCode = panel.pick?.team_code || cardPicks[0]?.team_code || games.at(-1)?.teamCode || null;
  const named = nblStatFromQuestion(opts.question);
  const stat = named || panel.pick?.stat || opts.stat || 'points';
  const userLine = lineFromQuestion(opts.question);
  const chartLine =
    stat === (opts.stat || 'points') && opts.selectedLine != null && Number.isFinite(Number(opts.selectedLine))
      ? Number(opts.selectedLine)
      : null;
  const focusPick = cardPicks.find((p) => p.stat === stat) ?? (panel.pick?.stat === stat ? panel.pick : null);
  const line = userLine ?? chartLine ?? focusPick?.line ?? null;
  const ctx: NblAskContext = {
    question: opts.question,
    intent,
    panel,
    games,
    player,
    last: lastNameOf(player),
    teamCode,
    opponentCode,
    stat,
    line,
    lineFromUser: userLine != null,
    read: null,
    cardPicks,
    ranked: [],
  };
  if (intent === 'take' && !named) {
    ctx.ranked = rankBets(ctx);
    const top = ctx.ranked[0];
    if (top && userLine == null) {
      ctx.stat = top.pick.stat;
      ctx.line = top.quote.line;
    }
  }
  ctx.read = readFor(ctx, ctx.stat, ctx.line);

  const local = localReply(ctx);
  if (!games.length && !panel.pick) return { ...local, source: 'stats', ...base };
  const pack = buildPack(ctx);
  const reply = await runAskAi({
    sportModel: process.env.NBL_ASK_MODEL,
    system: SYSTEM_PROMPT,
    userContent: buildAskUserContent({
      locks: locksFor(ctx),
      lens: LENSES[Math.floor(Math.random() * LENSES.length)],
      pack,
      question: opts.question,
    }),
    history: opts.history,
    question: opts.question,
    pack,
    local,
    allowLlm: opts.allowLlm,
    startedAt: opts.startedAt,
    checks: [
      (r) =>
        /\b(she|her|hers|herself)\b/i.test(askReplyText(r))
          ? `${ctx.last} is a man. Use he / him / his.`
          : null,
      (r) =>
        ctx.intent === 'take' && !ctx.lineFromUser && /\b1\.[0-4]\d\b/.test(askReplyText(r))
          ? `That price is under ${NBL_MIN_MODEL_DECIMAL.toFixed(2)}. Pick a market priced ${NBL_MIN_MODEL_DECIMAL.toFixed(2)} or more, or pass.`
          : null,
      askPriceCheck(priceOffers(cardPicks)),
    ],
  });
  return { ...reply, ...base };
}
