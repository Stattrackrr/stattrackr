/** Client-safe play type matchup types (NBA Synergy play types from BDL season averages). */

export const NBA_SYNERGY_PLAY_TYPES = [
  'isolation',
  'prballhandler',
  'prrollman',
  'spotup',
  'transition',
  'postup',
  'cut',
  'handoff',
  'offscreen',
  'offrebound',
] as const;

export type NbaSynergyPlayType = (typeof NBA_SYNERGY_PLAY_TYPES)[number];

export const NBA_SYNERGY_PLAY_TYPE_LABELS: Record<NbaSynergyPlayType, string> = {
  isolation: 'Isolation',
  prballhandler: 'P&R Ball Handler',
  prrollman: 'P&R Roll Man',
  spotup: 'Spot Up',
  transition: 'Transition',
  postup: 'Post Up',
  cut: 'Cut',
  handoff: 'Handoff',
  offscreen: 'Off Screen',
  offrebound: 'Putbacks',
};

export type NbaPlayTypeMatchupRow = {
  type: NbaSynergyPlayType;
  label: string;
  /** Player's points per game from this play type. */
  ppg: number;
  /** Share of the player's total points per game (0–100). */
  pointsPct: number | null;
  possPerGame: number;
  ppp: number | null;
  /** Share of the player's possessions (0–1). */
  frequency: number | null;
  /** League rank by points per game in this play type (1 = most). */
  rank: number | null;
  rankedPlayers: number;
  /** Estimated points per game the opponent allows from this play type. */
  oppAllowed: number | null;
  /** 1 = allows fewest (hardest), 30 = allows most (easiest). */
  oppRank: number | null;
  leagueAvgAllowed: number | null;
};

export type NbaPlayTypeMatchupPayload = {
  year: number;
  seasonLabel: string;
  playerId: string;
  opponentCode: string | null;
  opponentName: string | null;
  teamsRanked: number;
  rows: NbaPlayTypeMatchupRow[];
};
