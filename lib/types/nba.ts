// NBA TypeScript type definitions
export interface PlayerBio {
  name: string;
  firstName?: string;
  lastName?: string;
  heightFeet?: number;
  heightInches?: number;
  position?: string;
  weight?: number;
  college?: string;
  jersey?: number;
}

export interface SeasonAverages {
  pts?: number;
  reb?: number;
  ast?: number;
  fg3_pct?: number;
  fg_pct?: number;
  ft_pct?: number;
  min?: number;
  stl?: number;
  blk?: number;
  to?: number;
  pf?: number;
  fg3m?: number;
  fg3a?: number;
  fgm?: number;
  fga?: number;
  ftm?: number;
  fta?: number;
  oreb?: number;
  dreb?: number;
}

export interface AdvancedStats {
  player_efficiency_rating?: number;
  usage_percentage?: number;
  pace?: number;
  true_shooting_percentage?: number;
  effective_field_goal_percentage?: number;
  offensive_rating?: number;
  defensive_rating?: number;
  assist_percentage?: number;
  assist_to_turnover_ratio?: number;
  turnover_ratio?: number;
  rebound_percentage?: number;
  defensive_rebound_percentage?: number;
  net_rating?: number;
}

export interface ClutchStats {
  clutch_usage?: number;
  clutch_pts?: number;
  clutch_fg_pct?: number;
  clutch_3p_pct?: number;
}

export interface GameInfo {
  opponent: string;
  dateISO: string;
  homeAway: 'home' | 'away';
}

export interface TeamDefensiveRank {
  rank: number;
  value: number;
}

export interface DepthChartPlayer {
  name: string;
  jersey: number;
}

export interface TeamDepthChart {
  PG: DepthChartPlayer[];
  SG: DepthChartPlayer[];
  SF: DepthChartPlayer[];
  PF: DepthChartPlayer[];
  C: DepthChartPlayer[];
}

export interface PropLines {
  pts?: number;
  reb?: number;
  ast?: number;
  fg3m?: number;
  [key: string]: number | undefined;
}

export interface BookmakerLines {
  fanduel: PropLines;
  draftkings: PropLines;
  betmgm: PropLines;
  fanatics: PropLines;
}

export type BookmakerType = 'fanduel' | 'draftkings' | 'betmgm' | 'fanatics';
export type ChartMetricType = 'pts' | 'reb' | 'ast' | 'fg3m' | 'fg3a' | 'fg3_pct' | 'min' | 'stl' | 'blk' | 'fgm' | 'fga' | 'fg_pct' | 'oreb' | 'dreb' | 'ftm' | 'fta' | 'ft_pct' | 'to' | 'pf' | 'pra' | 'pr' | 'pa' | 'ra';
export type TimeframeType = 'last5' | 'last10' | 'last20' | 'h2h' | 'lastSeason' | 'thisSeason';