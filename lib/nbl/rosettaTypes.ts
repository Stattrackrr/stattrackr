/** Shared Rosetta / NBL entity shapes (subset used by StatTrackr). */

export type NblSeasonType = 'regular' | 'all' | 'in_season' | 'preseason' | 'finals' | string;

export type RosettaTeam = {
  id: string;
  external_id?: string | null;
  name: string;
  team_code?: string | null;
  team_logo?: string | null;
  team_logo_transparent?: string | null;
  external_team_logo?: string | null;
  team_nickname?: string | null;
  color_primary?: string | null;
  color_secondary?: string | null;
  color_tertiary?: string | null;
};

export type RosettaPlayer = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  external_id?: string | null;
  jersey_number?: string | number | null;
  playing_position?: string | null;
  height?: number | null;
  weight?: number | null;
  nationality_code?: string | null;
  image?: string | null;
  external_player_image?: string | null;
  active?: boolean | null;
};

export type RosettaSeason = {
  id: string;
  external_id?: string | null;
  name?: string | null;
  year: string | number;
  season_type: NblSeasonType;
};

export type RosettaStandingRow = {
  id?: string;
  position: number;
  played: number;
  won: number;
  lost: number;
  points_percentage?: number | null;
  win_percentage?: number | null;
  points_for?: number | null;
  points_against?: number | null;
  last_5?: string | null;
  streak?: number | null;
  home_wins?: number | null;
  home_losses?: number | null;
  away_wins?: number | null;
  away_losses?: number | null;
  team: RosettaTeam;
  season?: RosettaSeason;
};

export type RosettaMatch = {
  id: string;
  external_id?: string | null;
  start_time?: string | null;
  start_time_datetime?: string | null;
  round?: number | string | null;
  match_status?: string | null;
  status?: string | null;
  home_score?: string | number | null;
  away_score?: string | number | null;
  attendance?: number | null;
  match_slug?: string | null;
  venue?: { name?: string | null; timezone?: string | null } | null;
  home_team: RosettaTeam;
  away_team: RosettaTeam;
  season?: RosettaSeason;
};

export type RosettaRosterEntry = {
  jersey_number?: string | number | null;
  playing_position?: string | null;
  player: RosettaPlayer;
  team: RosettaTeam;
  season?: RosettaSeason;
};

export type RosettaPlayerSeasonStats = {
  games?: number | null;
  games_started?: number | null;
  minutes?: number | null;
  minutes_average?: number | null;
  points?: number | null;
  points_average?: number | null;
  rebounds?: number | null;
  rebounds_average?: number | null;
  offensive_rebounds?: number | null;
  defensive_rebounds?: number | null;
  assists?: number | null;
  assists_average?: number | null;
  steals?: number | null;
  steals_average?: number | null;
  blocks?: number | null;
  blocks_average?: number | null;
  turnovers?: number | null;
  turnovers_average?: number | null;
  fouls?: number | null;
  fouls_average?: number | null;
  personal_fouls?: number | null;
  field_goals_made?: number | null;
  field_goals_attempted?: number | null;
  field_goals_percentage?: number | null;
  field_goals_made_average?: number | null;
  field_goals_attempted_average?: number | null;
  three_points_made?: number | null;
  three_points_attempted?: number | null;
  three_points_percentage?: number | null;
  three_points_made_average?: number | null;
  three_points_attempted_average?: number | null;
  free_throws_made?: number | null;
  free_throws_attempted?: number | null;
  free_throws_percentage?: number | null;
  free_throws_made_average?: number | null;
  free_throws_attempted_average?: number | null;
  two_points_made?: number | null;
  two_points_attempted?: number | null;
  two_points_percentage?: number | null;
  efficiency?: number | null;
  efficiency_average?: number | null;
  plus_minus?: number | null;
  plus_minus_average?: number | null;
  player?: RosettaPlayer;
  team?: RosettaTeam;
  season?: RosettaSeason;
  period?: string | null;
};

export type RosettaPlayerBoxScore = RosettaPlayerSeasonStats & {
  participated?: boolean | null;
  playing_position?: string | null;
  match?: {
    id: string;
    external_id?: string | null;
    start_time_datetime?: string | null;
    status?: string | null;
    home_score?: string | number | null;
    away_score?: string | number | null;
    home_team?: RosettaTeam;
    away_team?: RosettaTeam;
    season?: RosettaSeason;
    venue?: { name?: string | null; timezone?: string | null } | null;
  };
  player?: RosettaPlayer;
  team?: RosettaTeam;
};

export type RosettaTeamSeasonStats = RosettaPlayerSeasonStats & {
  team?: RosettaTeam;
  results_string?: string | null;
};

/** Normalized game-log row for StatTrackr charts / box score. */
export type NblGameLogRow = {
  matchId: string;
  date: string | null;
  season: number;
  round: string | number | null;
  opponent: string;
  opponentCode: string | null;
  isHome: boolean;
  team: string;
  teamCode: string | null;
  result: string | null;
  venue?: string | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  offensiveRebounds: number | null;
  defensiveRebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fouls: number | null;
  fgMade: number | null;
  fgAttempted: number | null;
  fgPct: number | null;
  twoMade: number | null;
  twoAttempted: number | null;
  twoPct: number | null;
  threeMade: number | null;
  threeAttempted: number | null;
  threePct: number | null;
  ftMade: number | null;
  ftAttempted: number | null;
  ftPct: number | null;
  plusMinus: number | null;
  efficiency: number | null;
  pra: number | null;
  /** Points + Rebounds (NBA-style combo). */
  pr: number | null;
  /** Points + Assists. */
  pa: number | null;
  /** Rebounds + Assists. */
  ra: number | null;
};

/** Normalized season averages row for league snapshot. */
export type NblLeaguePlayerStatRow = {
  playerId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  team: string;
  teamCode: string | null;
  teamId: string | null;
  position: string | null;
  jersey: string | null;
  imageUrl: string | null;
  games: number;
  /** Season games started (Rosetta `games_started`). */
  gamesStarted: number;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fouls: number | null;
  fgPct: number | null;
  threePct: number | null;
  ftPct: number | null;
  threeMade: number | null;
  pra: number | null;
};
