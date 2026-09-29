import { inferBestOfFromOdds } from '@/lib/tennis/askOdds';
import { loadPlayerMatchesCached } from '@/lib/tennis/loadCached';
import { getTennisMatchOddsForPlayer } from '@/lib/tennis/odds';
import type { TennisMatchRow, TennisTour } from '@/lib/tennis/types';
import { FEED_STALE_MS, resolveAvailableMarkets } from '@/lib/tennisAi/availability';
import { answerPayload, buildMatchPack, findPriced, type MatchPack } from '@/lib/tennisAi/pack';
import { generateQuestions, matchQuestion, type GeneratedQuestion } from '@/lib/tennisAi/questions';
import { composeAnswer, type AnswerDraft } from '@/lib/tennisAi/answers';
import { currentBacktestReport } from '@/lib/tennisAi/store';
import type { HistoryMatch, Tour } from '@/lib/tennisAi/features';
import type { AvailableMarket } from '@/lib/tennisAi/types';

function unitRate(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value > 1 ? value / 100 : value;
}

export function historyFromRows(rows: TennisMatchRow[], tour: Tour): HistoryMatch[] {
  return rows
    .filter((row) => row.date && row.tour === tour)
    .map((row) => {
      const held = row.serviceGamesWon;
      const games = row.serveGames;
      const hold = held != null && games != null && games > 0 ? held / games : null;
      return {
        date: String(row.date),
        tour,
        surface: row.surface || 'Hard',
        playerId: row.playerId,
        opponentId: row.opponentId,
        isWin: Boolean(row.isWin),
        retired: /ret|w\/o|walk/i.test(String(row.result || row.score || '')),
        servicePointsWonPct: unitRate(row.servicePointsWonPct),
        returnPointsWonPct: unitRate(row.returnPointsWonPct),
        holdPct: hold,
        aces: row.aces,
        doubleFaults: row.doubleFaults,
        serveGames: row.serveGames,
        serveGamesPlayed: row.serveGames,
        minutes: row.minutes,
        setsPlayed: row.totalSets,
        tiebreak: row.score ? /\b7-6|6-7\b/.test(row.score) : null,
        wonTiebreak: null,
        firstSetWin: null,
        wonAfterLosingFirst: null,
        rank: row.playerRank,
        opponentRank: row.opponentRank,
        hand: row.hand,
        opponentHand: row.opponentHand,
      };
    });
}

export async function runTennisAi(input: {
  player: string;
  opponent: string;
  playerId?: string | null;
  opponentId?: string | null;
  tour: TennisTour;
  surface?: string | null;
  bestOf: 3 | 5;
  tournament?: string | null;
  question?: string | null;
  selectedBook?: string | null;
}): Promise<{
  markets: AvailableMarket[];
  questions: GeneratedQuestion[];
  pack: MatchPack | null;
  answer: AnswerDraft | null;
  missing: string | null;
}> {
  if (input.player.includes('/') || input.opponent.includes('/')) {
    return { markets: [], questions: [], pack: null, answer: null, missing: 'doubles' };
  }
  const odds = await getTennisMatchOddsForPlayer({
    playerId: input.playerId,
    playerName: input.player,
    opponentName: input.opponent,
  });
  const markets = resolveAvailableMarkets(odds, { fetchedAt: odds?.fetchedAt, staleAfterMs: FEED_STALE_MS });
  const last = (name: string) => name.split(/\s+/).filter(Boolean).at(-1) || name;
  const questions = generateQuestions({
    matchId: odds?.matchId || 'upcoming',
    markets,
    player: last(input.player),
    opponent: last(input.opponent),
    surface: (input.surface || 'hard').toLowerCase(),
    seed: 3,
    count: 4,
  }).questions;
  if (!input.question) return { markets, questions, pack: null, answer: null, missing: null };
  const [playerLogs, opponentLogs] = await Promise.all([
    loadPlayerMatchesCached({ playerId: input.playerId, playerName: input.player, tour: input.tour }),
    loadPlayerMatchesCached({ playerId: input.opponentId, playerName: input.opponent, tour: input.tour }),
  ]);
  const history = historyFromRows([...playerLogs, ...opponentLogs], input.tour);
  const playerId = input.playerId || playerLogs[0]?.playerId || input.player;
  const opponentId = input.opponentId || opponentLogs[0]?.playerId || input.opponent;
  const asOf = new Date().toISOString();
  const bestOf = inferBestOfFromOdds(input.bestOf, odds);
  const pack = buildMatchPack({
    asOf,
    tour: input.tour,
    surface: input.surface || playerLogs.at(-1)?.surface || 'Hard',
    bestOf,
    playerId,
    opponentId,
    history,
    markets,
    report: currentBacktestReport(),
    sims: 8000,
    seed: 7,
    selectedBook: input.selectedBook,
  });
  const matched = matchQuestion(input.question, markets, input.player, input.opponent);
  if (matched && 'missing' in matched) {
    const payload = answerPayload({
      player: input.player,
      opponent: input.opponent,
      surface: input.surface || 'Hard',
      bestOf,
      tournament: input.tournament || 'this event',
      question: input.question,
      selection: null,
      features: pack.features,
      report: pack.report,
    });
    payload.warnings = [`There is no ${matched.missing} line for this match, so it is not a bet.`];
    payload.confidence_tier = 'Insufficient data';
    const answer = await composeAnswer(payload);
    return { markets, questions, pack, answer, missing: matched.missing };
  }
  const selection = matched ? findPriced(pack.priced, matched) : null;
  const payload = answerPayload({
    player: input.player,
    opponent: input.opponent,
    surface: input.surface || 'Hard',
    bestOf,
    tournament: input.tournament || 'this event',
    question: input.question,
    selection,
    features: pack.features,
    report: pack.report,
  });
  const answer = await composeAnswer(payload);
  return { markets, questions, pack, answer, missing: null };
}
