// Types for NBA Dashboard

// Re-export NBAPlayer from lib for convenience
export type { NBAPlayer } from '@/lib/nbaPlayers';

export type OddsFormat = 'american' | 'decimal';

export type BookRow = {
  name: string;
  H2H: { home: string; away: string };
  Spread: { line: string; over: string; under: string };
  Total: { line: string; over: string; under: string };
  PTS: { line: string; over: string; under: string };
  REB: { line: string; over: string; under: string };
  AST: { line: string; over: string; under: string };
};

export type DepthPos = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export type DepthChartPlayer = { name: string; jersey?: string };
export type DepthChartData = Record<DepthPos, DepthChartPlayer[]>;

export type DerivedOdds = { openingLine?: number | null; currentLine?: number | null };
export type MovementRow = { ts: number; timeLabel: string; line: number; change: string; direction: 'up' | 'down' | 'flat' };
export type MatchupInfo = { tipoffLocal?: string | null; tipoffDate?: string | null } | null;

export interface OfficialOddsCardProps {
  bettingLine?: number;
  isDark: boolean;
  derivedOdds: DerivedOdds;
  intradayMovements: MovementRow[];
  selectedTeam: string;
  opponentTeam: string;
  selectedTeamLogoUrl: string;
  opponentTeamLogoUrl: string;
  matchupInfo: MatchupInfo;
  oddsFormat: OddsFormat;
  books: BookRow[];
  fmtOdds: (odds: string) => string;
  lineMovementEnabled: boolean;
  lineMovementData?: {
    openingLine: { line: number; bookmaker: string; timestamp: string } | null;
    currentLine: { line: number; bookmaker: string; timestamp: string } | null;
    impliedOdds: number | null;
    lineMovement: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
  } | null;
  selectedStat?: string;
  calculatedImpliedOdds?: {
    overImpliedProb: number | null;
    underImpliedProb: number | null;
  } | null;
  selectedBookmakerName?: string | null;
  selectedBookmakerLine?: number | null;
  propsMode?: 'player' | 'team';
  selectedPlayer?: any;
  primaryMarketLine?: number | null;
}

export interface BallDontLieGame {
  id: number;
  date: string;
  home_team?: { id: number; abbreviation: string; full_name: string; name: string };
  visitor_team?: { id: number; abbreviation: string; full_name: string; name: string };
  season: number;
  status: string;
}

export interface BallDontLieStats {
  id: number;
  ast: number; blk: number; dreb: number;
  fg3_pct: number; fg3a: number; fg3m: number;
  fg_pct: number; fga: number; fgm: number;
  ft_pct: number; fta: number; ftm: number;
  min: string; oreb: number; pf: number; pts: number; reb: number;
  stl: number; turnover: number;
  game?: BallDontLieGame;
  team?: { id: number; abbreviation: string; full_name: string; name: string };
  player?: any;
}

export type BdlSearchResult = { id: number; full: string; team?: string; pos?: string; headshotUrl?: string | null };
export type EspnPlayerData = { name: string; jersey?: string; height?: string; weight?: number; team?: string; position?: string };

export const SESSION_KEY = 'nba_dashboard_session_v1';
export type SavedSession = {
  player: BdlSearchResult;
  selectedStat: string;
  selectedTimeframe: string;
  propsMode: 'player' | 'team';
};

export type AltLineItem = {
  bookmaker: string;
  line: number;
  over: string;
  under: string;
  isPickem?: boolean;
  variantLabel?: string | null;
};

export interface AdvancedStats {
  offensive_rating?: number | null;
  defensive_rating?: number | null;
  net_rating?: number | null;
  true_shooting_percentage?: number | null;
  effective_field_goal_percentage?: number | null;
  usage_percentage?: number | null;
  pie?: number | null;
  pace?: number | null;
  rebound_percentage?: number | null;
  assist_percentage?: number | null;
  offensive_rebound_percentage?: number | null;
  assist_to_turnover?: number | null;
}

export type AverageStatInfo = {
  label: string;
  value: number;
  format?: 'percent';
};

export type HitRateStats = {
  overCount: number;
  underCount: number;
  total: number;
  totalBeforeFilters?: number; // Track total games before advanced filters (for "X/Y games" display)
  averages: AverageStatInfo[];
};

export interface PredictedOutcomeResult {
  overProb: number | null;
  underProb: number | null;
  confidence: 'High' | 'Medium' | 'Low';
  expectedValue?: number | null;
}
