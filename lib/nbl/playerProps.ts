/**
 * NBL player props from PulseScore (Sportsbet / TAB).
 */

import { nblPlayerPropMarketForStat, type NblBookRow } from '@/lib/nbl/oddsTypes';
import {
  findPulseNblGame,
  getNblPulseScoreBoard,
  pulseBooksByStat,
} from '@/lib/nbl/pulseScore';
import { resolveNblClubName } from '@/lib/nblTeamCanonical';

export async function resolveNblPlayerPropBooks(options: {
  player: string;
  stat: string;
  team?: string | null;
  opponent?: string | null;
}): Promise<{
  books: NblBookRow[];
  byStat: Record<string, NblBookRow[]>;
  homeTeam: string;
  awayTeam: string;
  gameId: string | null;
  market: string | null;
}> {
  const market = nblPlayerPropMarketForStat(options.stat);
  const empty = {
    books: [] as NblBookRow[],
    byStat: {} as Record<string, NblBookRow[]>,
    homeTeam: '',
    awayTeam: '',
    gameId: null as string | null,
    market,
  };
  if (!options.player) return empty;

  const team = options.team ? resolveNblClubName(options.team) || options.team : null;
  const opponent = options.opponent ? resolveNblClubName(options.opponent) || options.opponent : null;
  const games = await getNblPulseScoreBoard();
  const game = findPulseNblGame(games, team, opponent);
  if (!game) return empty;

  const byStat = pulseBooksByStat(game, options.player);
  return {
    books: (options.stat && byStat[options.stat]) || [],
    byStat,
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    gameId: game.gameId,
    market,
  };
}
