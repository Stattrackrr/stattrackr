/**
 * Client-safe types + labels for NBA similar players.
 */

export type NbaSimilarStatKey =
  | 'points'
  | 'rebounds'
  | 'assists'
  | 'steals'
  | 'blocks'
  | 'turnovers'
  | 'fouls'
  | 'threeMade'
  | 'pra'
  | 'pr'
  | 'pa'
  | 'ra'
  | 'minutes';

export const NBA_SIMILAR_STAT_LABELS: Record<NbaSimilarStatKey, string> = {
  points: 'Points',
  rebounds: 'Rebounds',
  assists: 'Assists',
  steals: 'Steals',
  blocks: 'Blocks',
  turnovers: 'Turnovers',
  fouls: 'Fouls',
  threeMade: '3PM',
  pra: 'PRA',
  pr: 'P+R',
  pa: 'P+A',
  ra: 'R+A',
  minutes: 'Minutes',
};

/** One similar-player game vs the opponent (max one player per match). */
export type NbaSimilarPlayerRow = {
  matchId: string;
  date: string | null;
  playerId: string;
  name: string;
  team: string;
  teamCode: string | null;
  position: string | null;
  imageUrl: string | null;
  similarity: number;
  minutes: number | null;
  /** Selected-stat value for this game. */
  value: number | null;
  /** Bookmaker prop line for this game — null until an odds feed is wired. */
  line: number | null;
  book: string | null;
};

export type NbaSimilarPlayersPayload = {
  year: number;
  stat: NbaSimilarStatKey;
  statLabel: string;
  player: {
    playerId: string;
    name: string;
    team: string;
    position: string | null;
  } | null;
  opponent: {
    code: string | null;
    name: string | null;
  };
  similar: NbaSimilarPlayerRow[];
};
