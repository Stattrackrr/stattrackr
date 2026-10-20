/**
 * Market vocabulary for AI pick legs. The generator writes these, the grader reads them.
 *
 * NBL (event_key = nblPlayerPropGameKey: `YYYY-MM-DD_home_vs_away`)
 *   Player props: market is an NBL_SNAP_STATS key, side over/under, player_id is the Rosetta player id.
 *     A milestone ("20+ points") is stored as over 19.5 with market_kind 'milestone'.
 *   h2h:    side home/away.
 *   spread: side home/away, line is the selected side's handicap (-4.5 = must win by 5+).
 *   total:  side over/under on combined points (overtime counts).
 *
 * NBA (event_key = nba_games.id; player_id is the BallDontLie player id)
 *   Same prop and game markets as NBL, plus
 *   doubleDouble / tripleDouble: side over, line 0.5 (yes: 10+ in two / three of pts, reb, ast, stl, blk).
 *
 * Tennis (event_key = API-Tennis event key; player_id is the player the bet is on, team is the opponent)
 *   match_winner:   side yes (player wins) / no.
 *   game_handicap:  side yes, line is the player's games handicap.
 *   total_games:    over/under total games in the match.
 *   player_games:   over/under games won by the player (opponent games = this market on the opponent).
 *   total_sets:     over/under sets played.
 *   player_sets:    over/under sets won by the player.
 *   win_a_set:      side yes (player wins at least one set) / no.
 */

export const NBL_PROP_MARKETS = ['points', 'rebounds', 'assists', 'threeMade', 'pra', 'pr', 'pa', 'ra'] as const;
export const NBL_GAME_MARKETS = ['h2h', 'spread', 'total'] as const;
export const NBA_ACHIEVEMENT_MARKETS = ['doubleDouble', 'tripleDouble'] as const;
export const TENNIS_MARKETS = [
  'match_winner',
  'game_handicap',
  'total_games',
  'player_games',
  'total_sets',
  'player_sets',
  'win_a_set',
] as const;

export type NblPropMarket = (typeof NBL_PROP_MARKETS)[number];
export type NblGameMarket = (typeof NBL_GAME_MARKETS)[number];
export type TennisMarket = (typeof TENNIS_MARKETS)[number];
export type NbaAchievementMarket = (typeof NBA_ACHIEVEMENT_MARKETS)[number];

export function isNblPropMarket(market: string): market is NblPropMarket {
  return (NBL_PROP_MARKETS as readonly string[]).includes(market);
}

export function isNbaAchievementMarket(market: string): market is NbaAchievementMarket {
  return (NBA_ACHIEVEMENT_MARKETS as readonly string[]).includes(market);
}

/** Any market settled on one player's box score. */
export function isPlayerPropMarket(market: string): boolean {
  return isNblPropMarket(market) || isNbaAchievementMarket(market);
}

export function isNblGameMarket(market: string): market is NblGameMarket {
  return (NBL_GAME_MARKETS as readonly string[]).includes(market);
}

export function isTennisMarket(market: string): market is TennisMarket {
  return (TENNIS_MARKETS as readonly string[]).includes(market);
}

/** `2026-10-18_sydney-kings_vs_perth-wildcats` → day + team slugs. */
export function parseNblEventKey(eventKey: string): { day: string; home: string; away: string } | null {
  const m = /^(\d{4}-\d{2}-\d{2})_(.+)_vs_(.+)$/.exec(String(eventKey || ''));
  if (!m) return null;
  return { day: m[1]!, home: m[2]!, away: m[3]! };
}
