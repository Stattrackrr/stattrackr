// Shared API response types for Ball Don't Lie and other APIs
// Eliminates the need for 'any' types throughout the codebase

/**
 * Ball Don't Lie Team
 */
export interface BdlTeam {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

/**
 * Ball Don't Lie Player
 */
export interface BdlPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height?: string;
  weight?: string;
  jersey_number?: string;
  college?: string;
  country?: string;
  draft_year?: number;
  draft_round?: number;
  draft_number?: number;
  team?: BdlTeam;
}

/**
 * Ball Don't Lie Game
 */
export interface BdlGame {
  id: number;
  date: string;
  season: number;
  status: string;
  period: number;
  time: string;
  postseason: boolean;
  home_team_score: number;
  visitor_team_score: number;
  home_team?: BdlTeam;
  visitor_team?: BdlTeam;
}

/**
 * Ball Don't Lie Player Stats
 */
export interface BdlPlayerStats {
  id: number;
  min: string;
  fgm: number;
  fga: number;
  fg_pct: number;
  fg3m: number;
  fg3a: number;
  fg3_pct: number;
  ftm: number;
  fta: number;
  ft_pct: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  pf: number;
  pts: number;
  player?: BdlPlayer;
  game?: BdlGame;
  team?: BdlTeam;
}

/**
 * Ball Don't Lie Advanced Stats
 */
export interface BdlAdvancedStats {
  id: number;
  assist_percentage: number;
  assist_ratio: number;
  assist_to_turnover: number;
  defensive_rating: number;
  defensive_rebound_percentage: number;
  effective_field_goal_percentage: number;
  net_rating: number;
  offensive_rating: number;
  offensive_rebound_percentage: number;
  pie: number;
  rebound_percentage: number;
  true_shooting_percentage: number;
  turnover_ratio: number;
  usage_percentage: number;
  pace: number;
  player: BdlPlayer;
}

/**
 * Ball Don't Lie Paginated Response
 */
export interface BdlPaginatedResponse<T> {
  data: T[];
  meta: {
    next_cursor?: number;
    per_page: number;
    current_page?: number;
    total_pages?: number;
  };
}

/**
 * Generic API Error Response
 */
export interface ApiErrorResponse {
  error: string;
  status?: number;
  details?: unknown;
}

/**
 * Generic API Success Response
 */
export interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    timestamp?: string;
    cached?: boolean;
    [key: string]: unknown;
  };
}
