import { mulberry32 } from '@/lib/tennisAi/rng';
import { marketIdentity } from '@/lib/tennisAi/availability';
import type { AvailableMarket, MarketKey } from '@/lib/tennisAi/types';

export type GeneratedQuestion = {
  id: string;
  text: string;
  market_key: MarketKey;
  selection: string;
  line: number | null;
  book: string | null;
  odds: number | null;
  data_available: boolean;
};

const TEMPLATES: Record<string, string[]> = {
  'MATCH_WINNER|PLAYER': [
    'Is {player} at {odds} actually worth it against {opponent} on {surface}?',
    'Can {player} really be this short against {opponent}?',
  ],
  'MATCH_WINNER|OPPONENT': [
    'Is {opponent} at {odds} a fair price against {player}?',
    'Does {opponent} have a real chance here at {odds}?',
  ],
  'TOTAL_GAMES|OVER': ['Is over {line} games a good bet with these two?'],
  'TOTAL_GAMES|UNDER': ['Is under {line} games the side, or does this one run long?'],
  'PLAYER_TOTAL_GAMES|OVER': ['Can {player} get over {line} games even if the match is one-sided?'],
  'PLAYER_TOTAL_GAMES|UNDER': ['Is under {line} games for {player} the lean here?'],
  'TOTAL_SETS|OVER': ['Is over {line} sets worth a look in this one?'],
  'TOTAL_SETS|UNDER': ['Do we get a short match under {line} sets?'],
  'PLAYER_ACES|OVER': ['Does {player} go over {line} aces here?'],
  'TIEBREAK_IN_MATCH|YES': ['Two strong holders, is there a tiebreak in this?'],
  'FIRST_SET_WINNER|PLAYER': ['Should I be looking at {player} to take the first set?'],
  'SET_BETTING|SCORE': ['Is a {score} result worth a look here?'],
};

function fill(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => tokens[key] ?? '');
}

/** Plus lines are the dog. "Too many to win by" is only for a favorite laying games. */
function handicapTemplates(line: number | null, who: 'PLAYER' | 'OPPONENT'): string[] {
  const dog = line != null && line > 0;
  if (who === 'OPPONENT') {
    return dog
      ? ['Does {opponent} cover {line} games against {player}?']
      : ['Does {opponent} cover {line} games against {player}, or is that too many games to win by?'];
  }
  return dog
    ? ['Does {player} cover {line} games against {opponent}?']
    : ['Does {player} cover {line} games against {opponent}, or is that too many games to win by?'];
}

function eligible(market: AvailableMarket): boolean {
  if (!market.featured) return false;
  if (market.key === 'GAME_HANDICAP' && market.line != null && Math.abs(market.line) < 1) return false;
  return market.priceable && !market.stale && market.model !== 'unmodelled' && Boolean(market.best);
}

export function generateQuestions(input: {
  matchId: string;
  markets: AvailableMarket[];
  player: string;
  opponent: string;
  surface: string;
  seed?: number;
  count?: number;
}): { match_id: string; questions: GeneratedQuestion[] } {
  const rand = mulberry32(input.seed ?? 1);
  const pool = input.markets.filter(eligible);
  const byKey = new Map<string, AvailableMarket[]>();
  for (const market of pool) {
    const list = byKey.get(market.key) || [];
    list.push(market);
    byKey.set(market.key, list);
  }
  const priority = ['GAME_HANDICAP', 'TOTAL_GAMES', 'MATCH_WINNER', 'PLAYER_TOTAL_GAMES', 'TOTAL_SETS'];
  const keys = [
    ...priority.filter((key) => byKey.has(key)),
    ...[...byKey.keys()].filter((key) => !priority.includes(key)),
  ];
  const picked: AvailableMarket[] = [];
  const want = Math.min(5, Math.max(0, input.count ?? 4));
  for (const key of keys) {
    if (picked.length >= want) break;
    const options = byKey.get(key) || [];
    const preferred =
      options.find((row) => row.selection === 'UNDER' || row.selection === 'PLAYER') || options[0];
    if (preferred) picked.push(preferred);
  }
  let guard = 0;
  while (picked.length < Math.min(want, pool.length) && guard < 20) {
    guard += 1;
    const market = pool[Math.floor(rand() * pool.length)];
    const id = marketIdentity(market);
    if (picked.some((row) => marketIdentity(row) === id)) continue;
    const winnerCount = picked.filter((row) => row.key === 'MATCH_WINNER').length;
    if (market.key === 'MATCH_WINNER' && winnerCount >= 1 && keys.length > 1) continue;
    picked.push(market);
  }
  const known = new Set(input.markets.map(marketIdentity));
  const questions = picked.slice(0, 5).map((market, index) => {
    const family =
      market.key === 'GAME_HANDICAP'
        ? handicapTemplates(market.line, market.selection === 'OPPONENT' ? 'OPPONENT' : 'PLAYER')
        : TEMPLATES[`${market.key}|${market.selection}`] ||
          TEMPLATES[`${market.key}|SCORE`] || [
            `What do you make of the ${market.name.toLowerCase()} at ${market.line ?? 'this price'}?`,
          ];
    const template = family[Math.floor(rand() * family.length)];
    const odds = market.best ? market.best.decimalOdds.toFixed(2) : '';
    const text = fill(template, {
      player: input.player,
      opponent: input.opponent,
      surface: input.surface || 'this surface',
      line:
        market.line == null
          ? ''
          : market.key === 'GAME_HANDICAP' || market.key === 'SET_HANDICAP'
            ? market.line > 0
              ? `+${market.line}`
              : String(market.line)
            : String(market.line),
      odds,
      score: market.score || '',
    }).replace(/\s+/g, ' ').trim();
    const row: GeneratedQuestion = {
      id: `q${index + 1}`,
      text,
      market_key: market.key,
      selection: market.selection,
      line: market.line,
      book: market.best?.book ?? null,
      odds: market.best?.decimalOdds ?? null,
      data_available: known.has(marketIdentity(market)) && eligible(market),
    };
    return row;
  });
  return {
    match_id: input.matchId,
    questions: questions.filter((row) => row.data_available && known.has(`${row.market_key}|${row.selection}|${row.line ?? ''}`)),
  };
}

function hasKey(markets: AvailableMarket[], key: MarketKey): boolean {
  return markets.some((market) => market.key === key && market.priceable && !market.stale);
}

/** Map a free-text question onto a priced market, or say the market is not on the board. */
export function matchQuestion(
  question: string,
  markets: AvailableMarket[],
  player: string,
  opponent: string
): AvailableMarket | { missing: string } | null {
  const q = question.toLowerCase();
  const priced = markets.filter((market) => market.priceable && !market.stale && market.model !== 'unmodelled');
  const lineMatch = q.match(/([+-]?\d+(?:\.\d+)?)/);
  const line = lineMatch ? Number(lineMatch[1]) : null;
  const side =
    /\bunder\b/.test(q) ? 'UNDER' : /\bover\b/.test(q) ? 'OVER' : null;
  const wants = (pattern: RegExp, key: MarketKey, label: string) => {
    if (!pattern.test(q)) return null;
    if (!hasKey(markets, key)) return { missing: label } as const;
    const rows = priced.filter((market) => market.key === key);
    if (line != null) {
      const exact = rows.find(
        (market) => market.line === line && (side == null || market.selection === side || key === 'GAME_HANDICAP')
      );
      if (exact) return exact;
      return { missing: `${label} ${line}` } as const;
    }
    const sided = side ? rows.find((market) => market.selection === side) : null;
    return sided || rows[0] || { missing: label };
  };
  const lastName = (name: string) => name.split(/\s+/).filter(Boolean).at(-1)?.toLowerCase() || '';
  const playerLast = lastName(player);
  const oppLast = lastName(opponent);
  const namedPlayer =
    (playerLast.length >= 3 && q.includes(playerLast)) ||
    (oppLast.length >= 3 && q.includes(oppLast)) ||
    q.includes(player.toLowerCase()) ||
    q.includes(opponent.toLowerCase());
  const playerGamesAsk =
    /\bgames won\b|\bplayer games\b|\bhis games\b|\bher games\b/.test(q) ||
    (/\bgames\b/.test(q) && namedPlayer && !/\btotal games\b|\bmatch total\b/.test(q)) ||
    (line != null && line <= 16 && /\bgames\b/.test(q) && !/\btotal games\b|\bmatch total\b/.test(q));

  const aces = wants(/\baces?\b/, 'PLAYER_ACES', 'aces');
  if (aces && 'missing' in aces) return aces;
  if (aces && !('missing' in aces)) return aces;
  const dfs = wants(/double fault/, 'PLAYER_DOUBLE_FAULTS', 'double faults');
  if (dfs) return dfs;
  const tie = wants(/tiebreak/, 'TIEBREAK_IN_MATCH', 'tiebreak');
  if (tie) return tie;
  const sets = wants(/\bsets?\b/, 'TOTAL_SETS', 'sets');
  if (sets && !/\bfirst set\b/.test(q)) return sets;
  const spread = wants(/cover|handicap|spread/, 'GAME_HANDICAP', 'game handicap');
  if (spread) return spread;
  if (playerGamesAsk) {
    const playerGames = wants(/games/, 'PLAYER_TOTAL_GAMES', 'player games');
    if (playerGames) return playerGames;
  }
  const games = wants(/\btotal games\b|\bmatch total\b|(?<!player\s)total/, 'TOTAL_GAMES', 'total games');
  if (games) return games;
  if (/\bgames\b/.test(q) && line != null && line >= 18) {
    const totals = wants(/games/, 'TOTAL_GAMES', 'total games');
    if (totals) return totals;
  }
  const winnerRows = priced.filter((market) => market.key === 'MATCH_WINNER');
  if (!winnerRows.length && /win|moneyline|price|worth/.test(q)) return { missing: 'match winner' };
  const playerHit = q.includes(player.toLowerCase());
  const oppHit = q.includes(opponent.toLowerCase());
  if (oppHit && !playerHit) return winnerRows.find((row) => row.selection === 'OPPONENT') || winnerRows[0] || null;
  return winnerRows.find((row) => row.selection === 'PLAYER') || winnerRows[0] || null;
}
