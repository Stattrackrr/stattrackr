import type { PlayerMatchStats } from '@/lib/soccerPlayerStatsScrape';

export type SoccerPlayerChartTimeframe =
  | 'last5'
  | 'last10'
  | 'last20'
  | 'last50'
  | 'h2h'
  | 'thisSeason'
  | 'lastSeason'
  | 'all';

export type SoccerPlayerPropsChartSnapshot = {
  matches: PlayerMatchStats[];
  /** Canonical stat key from the main chart (e.g. total_shots). */
  mainStatKey: string;
  timeframe: SoccerPlayerChartTimeframe;
  competitionFilter: string;
  loading: boolean;
};
