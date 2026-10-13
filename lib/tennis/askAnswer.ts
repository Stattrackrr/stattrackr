import { askReplyText, askLlmConfig, type AskMessage } from '@/lib/ai/ask/llm';
import { buildAskSystemPrompt, buildAskUserContent } from '@/lib/ai/ask/rules';
import { runAskAi, type AskReply } from '@/lib/ai/ask/run';
import {
  compactTennisAnalysis,
  tennisFormFraction,
  type TennisMatchAnalysis,
} from '@/lib/tennis/matchAnalyst';
import type { TennisAskBrief } from '@/lib/tennis/askBrief';
import type { TennisMatchRow } from '@/lib/tennis/types';
import {
  evaluateUserStatLine,
  formatUserLineWindow,
  parseUserStatLine,
  userLineClears,
  type UserLineContext,
  type UserLineEval,
} from '@/lib/tennis/askUserLine';

const EMPTY_BRIEF = { similarVsOpponent: [] } as Pick<TennisAskBrief, 'similarVsOpponent'> as TennisAskBrief;

export type TennisAskMessage = AskMessage;
export type TennisAskReply = AskReply;

export function tennisAskConfigured(): boolean {
  return askLlmConfig(process.env.TENNIS_ASK_MODEL) != null;
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

const TENNIS_RULES = `Tennis:
- No abbreviations like L15, BO3, H2H, RPW, BP or DF — write "last 15", "best-of-3", "head to head", "double faults". Say "holds serve 69% of the time", not "hold % 69".
- Stats that matter: hold, break, aces, double faults, games won/lost, last 10 / last 15 totals, head to head, surface, userLine hit rates. Name surfaces when you use them.
- Format first: format.bestOf is this match. ATP slams are best of 5. If bestOf is 5, never mention 21.5 or 22.5 unless the user typed that number.
- Say the format out loud. The user cannot see the filter. When you quote last-15 match lengths, overs, hold/break, or hit rates, write "last 15 best-of-3 matches" or "last 15 best-of-5 matches" to match format.bestOf. Never say "last 15" or "last-15 match lengths" without best-of-3 or best-of-5.
- Totals vs player games: userLine.stat is the source of truth. totalGames = match total (both players). gamesWon = one player's games. "run long" / "match total" / "total games" = match total. "for Xiao" / "games won" = that player's games. In best of 3, 18.5 is a normal PLAYER games line — do not assume it is the match total. In best of 3, 21.5 / 22.5 is usually the match total. In best of 5, 18.5 is player games and 38.5+ is the match total. viewing.stat is only a tie-break when the number could be either.
- Totals: books.listedTotalLine is the book match total. Grade it with player.last15.totalGames (already the same best-of as this match). Never mix slam lengths (30+ games) into a best-of-3 total.
- Set markets: books.sets has, per book, each player to win a set, each player in straight sets, and the total sets line. A null price is not offered, so never quote or suggest it. To win a set is graded with last15.wonASet, straight sets with last15.straightSetWins and the other side's straightSetLosses, total sets over with last15.decidingSet. Those are hits over finished matches, like 12/15.
- H2H game averages are often from BO3 meetings. Do not compare h2h.avgGames to a BO5 38.5–43.5 total.
- Cover counts read like over/under counts: "covered in 9 of her last 15", never next to a win record.
- Last-5 is player.last5 over player.last5Sample, not the unfiltered L5 moneyline chart. If last5Sample is "last 5 hard best-of-3 matches", say that. Do not count slams or clay in that number. last5Matches are those matches in order.
- Win records come only from last5 / last10 / last15.record / surface.record. A handicap or over/under hit rate (like covered 13 of 15) is not a win record. Never write "X is 15/15" from a cover or over hit rate.
- Retired and walkover matches are left out of every games number and over/under count. If a count left one out, quote it as it is (like 3 of 14) and you may say a retirement was left out.
- Old head to head: name the surface of a meeting if it differs from this match.
- Pronouns: player.pronouns and opponent.pronouns come from the tour (ATP = men, WTA = women).`;

const SYSTEM_PROMPT = buildAskSystemPrompt({ subject: 'this tennis match', sportRules: TENNIS_RULES });

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

type AskViewing = {
  stat?: string | null;
  line?: number | null;
  playerRows?: TennisMatchRow[] | null;
  opponentRows?: TennisMatchRow[] | null;
};

function viewingContext(analysis: TennisMatchAnalysis, viewing?: AskViewing): UserLineContext {
  return {
    viewingStat: viewing?.stat || null,
    viewingLine: viewing?.line ?? null,
    listedTotalLine: analysis.marketOdds?.listedTotalLine ?? analysis.model.totalsLine ?? null,
    bestOf: analysis.bestOf === 5 ? 5 : 3,
    playerLast: analysis.player.last,
    opponentLast: analysis.opponent.last,
    playerName: analysis.player.name,
    opponentName: analysis.opponent.name,
    playerRows: viewing?.playerRows ?? null,
    opponentRows: viewing?.opponentRows ?? null,
  };
}

function punterStats(analysis: TennisMatchAnalysis) {
  const compact = compactTennisAnalysis(analysis);
  const identity = tourPlayers(analysis);
  return {
    match: compact.match,
    tour: compact.tour,
    surface: compact.surface,
    format: compact.format,
    player: { ...identity, ...compact.player },
    opponent: { ...identity, ...compact.opponent },
    h2h: compact.h2h,
    books: {
      listedTotalLine: compact.totals.listedBookLine,
      totals: compact.marketOdds.totals,
      totalsAtListed: compact.marketOdds.totalsAtListed,
      moneyline: compact.marketOdds.moneyline,
      sets: compact.marketOdds.sets,
    },
    aces: {
      playerL15Aces: compact.aces.playerL15Aces,
      opponentAcesAllowedL15: compact.aces.opponentAcesAllowedL15,
    },
  };
}

function buildAskPack(
  analysis: TennisMatchAnalysis,
  question: string,
  viewing?: AskViewing
) {
  const ctx = viewingContext(analysis, viewing);
  return {
    stats: punterStats(analysis),
    viewing: {
      stat: ctx.viewingStat,
      line: ctx.viewingLine,
      player: analysis.player.last,
      hintOnly: true,
      meaning:
        'Chart tab is a tie-break only. Follow userLine.stat. BO3 18.5 can be player games won. BO3 21.5+ or "run long" is match total. BO5 18.5 is player games.',
    },
    userLine: evaluateUserStatLine(analysis, EMPTY_BRIEF, question, ctx),
  };
}

function formatSample(bestOf: 3 | 5): string {
  return bestOf === 5 ? 'best-of-5' : 'best-of-3';
}

function tourIsWta(analysis: Pick<TennisMatchAnalysis, 'tour'>): boolean {
  return String(analysis.tour || '').toUpperCase() === 'WTA';
}

function tourPlayers(analysis: Pick<TennisMatchAnalysis, 'tour'>) {
  return tourIsWta(analysis)
    ? { gender: 'woman', pronouns: 'she / her / hers / herself' }
    : { gender: 'man', pronouns: 'he / him / his / himself' };
}

/** True when the reply misgenders the players for their tour, so the AI is asked to rewrite it. */
export function tennisReplyMisgenders(text: string, tour: string | null | undefined): boolean {
  return String(tour || '').toUpperCase() === 'WTA'
    ? /\b(he|him|his|himself)\b/i.test(text)
    : /\b(she|her|hers|herself)\b/i.test(text);
}

function localBreakdown(analysis: TennisMatchAnalysis): string[] {
  const { player, opponent, h2h } = analysis;
  const sample = formatSample(analysis.bestOf === 5 ? 5 : 3);
  const their = tourIsWta(analysis) ? 'her' : 'his';
  const lines: string[] = [];
  if (player.l15.aces != null && opponent.l15.acesAllowed != null) {
    lines.push(
      `${player.last} is averaging ${player.l15.aces} aces over ${their} last 15 ${sample} matches. ${opponent.last} has been allowing ${opponent.l15.acesAllowed}.`
    );
  }
  if (player.l15.holdPct != null && opponent.l15.breakPct != null) {
    lines.push(
      `${player.last} has held ${player.l15.holdPct}% in last 15 ${sample} matches. ${opponent.last} has broken ${opponent.l15.breakPct}%.`
    );
  }
  if (player.l15.df != null) {
    lines.push(`${player.last} is coughing up ${player.l15.df} double faults per match in that same ${sample} window.`);
  }
  if (player.l15.totalGames != null && opponent.l15.totalGames != null) {
    lines.push(
      `Last 15 ${sample} matches: ${player.last} is around ${player.l15.totalGames} total games, ${opponent.last} around ${opponent.l15.totalGames}.`
    );
  }
  const surface =
    analysis.surface === 'hard' || analysis.surface === 'clay' || analysis.surface === 'grass' ? `${analysis.surface} ` : '';
  const wonOfLast = (record: string, pronoun: string) => {
    const [wins, total] = tennisFormFraction(record).split('/');
    return `has won ${wins} of ${pronoun} last ${total} ${surface}${sample} matches`;
  };
  lines.push(`${player.last} ${wonOfLast(player.l10.record, their)}. ${opponent.last} ${wonOfLast(opponent.l10.record, their)}.`);
  const streak = player.timeline.streak;
  if (streak && streak.count >= 3) {
    lines.push(`${player.last} has ${streak.result} ${their} last ${streak.count} matches in a row.`);
  }
  if (h2h.matches) {
    const old = h2h.lastMeeting && h2h.lastMeeting.monthsAgo >= 12 ? `, but the last meeting was ${h2h.lastMeeting.ago}` : '';
    lines.push(`Head to head is ${h2h.record} for ${player.last} across ${h2h.matches} matches${old}.`);
  }
  if (player.l15.holdPct != null && opponent.l15.holdPct != null) {
    lines.push(
      `${player.last} has been holding ${player.l15.holdPct}% on file. ${opponent.last} is at ${opponent.l15.holdPct}%.`
    );
  }
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
  const l15 = evaled.windows.find((row) => row.label.startsWith('L15'));
  const vs = evaled.windows.find((row) => row.label.startsWith('vs '));
  const rates = [l15?.pct, evaled.similarVsOpponent?.pct, vs?.pct].filter(
    (value): value is number => value != null
  );
  const avgHit = rates.length ? rates.reduce((sum, value) => sum + value, 0) / rates.length : null;
  const projClears = evaled.projection != null && userLineClears(evaled.projection, evaled.asked);
  const sample = formatSample(analysis.bestOf === 5 ? 5 : 3);
  const hitBit = l15?.pct != null ? `${l15.pct}% of last ${l15.sample} ${sample} matches` : null;
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
  question: string,
  viewing?: AskViewing
): { answer: string; breakdown: string[] } {
  const q = String(question || '').toLowerCase();
  const { player, opponent, model } = analysis;
  const userLine = evaluateUserStatLine(
    analysis,
    EMPTY_BRIEF,
    question,
    viewingContext(analysis, viewing)
  );
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
        answer: `I do not have a clean ${gamesLine} cover sample for ${name}. From the last 15 I still lean ${player.last} in the match, but I would not force that spread.`,
        breakdown,
      };
    }
    return {
      answer:
        pct >= 50
          ? `${name} covering ${gamesLine} looks okay off recent matches, but I would not steam it.`
          : `${name} covering ${gamesLine} has been a struggle lately. I would pass unless the price is huge.`,
      breakdown,
    };
  }

  if (/\bace/.test(q)) {
    const playerAces = player.l15.aces;
    const oppAllowed = opponent.l15.acesAllowed;
    return {
      answer:
        playerAces != null
          ? `There is no listed player ace line on the chart. ${player.last} is at ${playerAces} aces over the last 15 ${formatSample(analysis.bestOf === 5 ? 5 : 3)} matches${
              oppAllowed != null ? `, and ${opponent.last} has been allowing ${oppAllowed}` : ''
            }, so I would judge the ace spot off that projection, not a fake 11.5.`
          : 'There is no listed ace line on the chart. Use the raw ace and ace-allowed numbers instead.',
      breakdown,
    };
  }

  if (/\btotal games\b|\bmatch total\b/.test(q) || (/\b(over|under)\b/.test(q) && /\bgames\b/.test(q) && !parseUserStatLine(q, viewingContext(analysis, viewing)))) {
    const listed = analysis.marketOdds?.listedTotalLine ?? model.totalsLine;
    const pGames = player.l15.totalGames;
    const oGames = opponent.l15.totalGames;
    return {
      answer:
        analysis.bestOf === 5
          ? `This is best of 5, so ignore any 22.5 talk. The book is ${listed}. ${player.last}'s last 15 best-of-5 matches have been around ${pGames ?? 'the high 20s'} games, so I would rather the over than a short one.`
          : `Under ${listed} is not the side I want if ${player.last}'s last 15 best-of-3 matches have been around ${pGames ?? '22'} games and ${opponent.last} around ${oGames ?? '22'}. I would rather this run long.`,
      breakdown,
    };
  }

  const name = side === 'opponent' ? opponent.last : side === 'player' ? player.last : model.winner;
  if (side && name !== model.winner) {
    return {
      answer: `I would not back ${name} here off the last 15. Hold and break have been pointing the other way.`,
      breakdown,
    };
  }
  return {
    answer: `I would lean ${name} from the recent hold/break, but I would still check the total before slamming the winner.`,
    breakdown,
  };
}

function askUserContent(
  question: string,
  analysis: TennisMatchAnalysis,
  viewing?: AskViewing
): { content: string; pack: ReturnType<typeof buildAskPack> } {
  const pack = buildAskPack(analysis, question, viewing);
  const userLine = parseUserStatLine(question, viewingContext(analysis, viewing));
  const line = askedGamesLine(question);
  const side = namedSide(question, analysis);
  const lens = LENSES[Math.floor(Math.random() * LENSES.length)];
  const formatLock =
    analysis.bestOf === 5
      ? `This match is BEST OF 5. Every last-15 number is last 15 BEST-OF-5 matches. Say "best-of-5" when you quote those lengths. Book total is ${analysis.marketOdds?.listedTotalLine ?? analysis.model.totalsLine}. Never quote 22.5.`
      : `This match is BEST OF 3. Every last-15 number is last 15 BEST-OF-3 matches. Say "best-of-3" when you quote those lengths so the punter knows slams are out. Book total is ${analysis.marketOdds?.listedTotalLine ?? analysis.model.totalsLine}.`;
  const lock = pack.userLine
    ? pack.userLine.asked.stat === 'totalGames'
      ? `The user asked the MATCH TOTAL ${pack.userLine.asked.display} (both players added). Not ${analysis.player.last}'s games won. Grade with last-15 best-of-${analysis.bestOf === 5 ? 5 : 3} match lengths.`
      : pack.userLine.asked.stat === 'spread'
        ? `The user asked a GAME HANDICAP: ${pack.userLine.asked.display} for ${pack.userLine.subject}. Plus = dog (cover by winning or only losing by 1). Minus = favorite (must win by more than that). Never call a plus line "too many".`
        : `The user asked ${pack.userLine.asked.display} for ${pack.userLine.subject}. Grade THAT player's games won, not the match total.`
    : userLine
      ? userLine.stat === 'totalGames'
        ? `The user asked the MATCH TOTAL ${userLine.display}. Not one player's games.`
        : userLine.stat === 'spread'
          ? `The user asked ${userLine.display}. That is a handicap, not a match total.`
        : `The user named ${userLine.display}. Grade that number from the stats. Do not invent a book line.`
      : line != null
        ? `The user asked about a ${line} game handicap${side ? ` for ${side === 'player' ? analysis.player.last : analysis.opponent.last}` : ''}. Say whether they cover that spread. Never mention the pack.`
        : 'No specific user number was locked.';
  const identity = tourPlayers(analysis);
  const pronounLock = `${tourIsWta(analysis) ? 'WTA' : 'ATP'} match: ${analysis.player.last} and ${analysis.opponent.last} are each a ${identity.gender}. Refer to them as ${identity.pronouns}.`;
  return {
    content: buildAskUserContent({ locks: [formatLock, lock, pronounLock], lens, pack, question }),
    pack,
  };
}

export async function answerTennisAsk(opts: {
  question: string;
  analysis: TennisMatchAnalysis;
  history?: TennisAskMessage[];
  allowLlm?: boolean;
  viewingStat?: string | null;
  viewingLine?: number | null;
  playerRows?: TennisMatchRow[] | null;
  opponentRows?: TennisMatchRow[] | null;
  /** When the request arrived, so data loading counts against the panel's timeout. */
  startedAt?: number;
}): Promise<TennisAskReply> {
  const viewing: AskViewing = {
    stat: opts.viewingStat || null,
    line: opts.viewingLine ?? null,
    playerRows: opts.playerRows,
    opponentRows: opts.opponentRows,
  };
  const local = buildLocalAskReply(opts.analysis, opts.question, viewing);
  const { content, pack } = askUserContent(opts.question, opts.analysis, viewing);
  const { tour } = opts.analysis;
  const identity = tourPlayers(opts.analysis);
  return runAskAi({
    sportModel: process.env.TENNIS_ASK_MODEL,
    system: SYSTEM_PROMPT,
    userContent: content,
    history: opts.history,
    question: opts.question,
    pack,
    local,
    allowLlm: opts.allowLlm,
    startedAt: opts.startedAt,
    checks: [
      (reply) =>
        tennisReplyMisgenders(askReplyText(reply), tour)
          ? `You misgendered the players. This is a ${tour} match: ${opts.analysis.player.last} and ${opts.analysis.opponent.last} are each a ${identity.gender}, so use ${identity.pronouns}.`
          : null,
    ],
  });
}
