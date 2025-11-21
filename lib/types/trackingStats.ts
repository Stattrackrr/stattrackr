// lib/types/trackingStats.ts

export interface TrackingStatsResponse {
  player_id: string;
  season: string;
  per_mode: string;
  season_type: string;
  base_stats: BaseStats | null;
  passing_stats: PassingStats | null;
  rebounding_stats: ReboundingStats | null;
}

export interface BaseStats {
  PLAYER_ID: number;
  PLAYER_NAME: string;
  TEAM_ID: number;
  TEAM_ABBREVIATION: string;
  AGE: number;
  GP: number;
  W: number;
  L: number;
  MIN: number;
  FGM: number;
  FGA: number;
  FG_PCT: number;
  FG3M: number;
  FG3A: number;
  FG3_PCT: number;
  FTM: number;
  FTA: number;
  FT_PCT: number;
  OREB: number;
  DREB: number;
  REB: number;
  AST: number;
  STL: number;
  BLK: number;
  TOV: number;
  PF: number;
  PTS: number;
  PLUS_MINUS: number;
}

export interface PassingStats {
  PLAYER_ID: number;
  PLAYER_NAME: string;
  TEAM_ID: number;
  TEAM_ABBREVIATION: string;
  GP: number;
  W: number;
  L: number;
  MIN: number;
  PASSES_MADE: number;
  PASSES_RECEIVED: number;
  FT_AST: number;
  SECONDARY_AST: number;
  POTENTIAL_AST: number;
  AST_PTS_CREATED: number;
  AST_ADJ: number;
  AST_TO_PASS_PCT: number;
  AST_TO_PASS_PCT_ADJ: number;
}

export interface ReboundingStats {
  PLAYER_ID: number;
  PLAYER_NAME: string;
  TEAM_ID: number;
  TEAM_ABBREVIATION: string;
  GP: number;
  W: number;
  L: number;
  MIN: number;
  REB: number;
  REB_CONTEST: number;
  REB_UNCONTEST: number;
  REB_CONTEST_PCT: number;
  OREB: number;
  OREB_CONTEST: number;
  OREB_UNCONTEST: number;
  OREB_CONTEST_PCT: number;
  DREB: number;
  DREB_CONTEST: number;
  DREB_UNCONTEST: number;
  DREB_CONTEST_PCT: number;
  REB_CHANCES: number;
  REB_CHANCE_PCT: number;
  OREB_CHANCES: number;
  OREB_CHANCE_PCT: number;
  DREB_CHANCES: number;
  DREB_CHANCE_PCT: number;
  AVG_REB_DIST: number;
  AVG_OREB_DIST: number;
  AVG_DREB_DIST: number;
}

export interface TrackingStatsError {
  error: string;
  details?: string;
}

