// Types for Ball Don't Lie API - Advanced Stats
export interface Player {
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
}

export interface Team {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

export interface AdvancedStats {
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
  player: Player;
}

export interface AdvancedStatsResponse {
  data: AdvancedStats[];
  meta: {
    next_cursor?: number;
    per_page: number;
  };
}

export interface ApiError {
  message: string;
  status?: number;
}