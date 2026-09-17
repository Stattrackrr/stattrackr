export const ADV_AVG_WINDOWS = [
  { id: 5, label: 'Last 5' },
  { id: 10, label: 'Last 10' },
  { id: 15, label: 'Last 15' },
  { id: 20, label: 'Last 20' },
  { id: 0, label: 'Season' },
] as const;

export const ADV_AVG_BEST_OF = [
  { id: 'all', label: 'All' },
  { id: '3', label: 'BO3' },
  { id: '5', label: 'BO5' },
] as const;

export const TENNIS_OPP_RANK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'top10', label: 'Top 10' },
  { id: '11-25', label: '11-25' },
  { id: '26-50', label: '26-50' },
  { id: '51-100', label: '51-100' },
  { id: '101-250', label: '101-250' },
  { id: '251-500', label: '251-500' },
  { id: '500+', label: '500+' },
] as const;

export type TennisOppRankFilter = (typeof TENNIS_OPP_RANK_FILTERS)[number]['id'];

const OPP_RANK_RANGE: Record<Exclude<TennisOppRankFilter, 'all'>, { min: number; max: number }> = {
  top10: { min: 1, max: 10 },
  '11-25': { min: 11, max: 25 },
  '26-50': { min: 26, max: 50 },
  '51-100': { min: 51, max: 100 },
  '101-250': { min: 101, max: 250 },
  '251-500': { min: 251, max: 500 },
  '500+': { min: 501, max: Number.POSITIVE_INFINITY },
};

export function matchTennisOppRank(raw: unknown, filter: TennisOppRankFilter): boolean {
  if (filter === 'all') return true;
  const rank = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(rank) || rank <= 0) return false;
  const range = OPP_RANK_RANGE[filter];
  if (!range) return true;
  return rank >= range.min && rank <= range.max;
}

export const ADV_AVG_VS_RANKS = [
  { id: 'all', label: 'vs All' },
  { id: 'top10', label: 'Top 10' },
  { id: '11-25', label: '11-25' },
  { id: '26-50', label: '26-50' },
  { id: '51-100', label: '51-100' },
  { id: '101-250', label: '101-250' },
  { id: '251-500', label: '251-500' },
  { id: '500+', label: '500+' },
] as const;

export const ADV_AVG_COLUMNS = [
  { key: 'wl', label: 'W-L' },
  { key: 'dr', label: 'DR' },
  { key: 'games', label: 'Games Won' },
  { key: 'hold', label: 'Hold %' },
  { key: 'bpw', label: 'BP W%' },
  { key: 'rpw', label: 'RPW%' },
  { key: 'aces', label: 'Aces' },
  { key: 'aceAll', label: 'Ace All' },
  { key: 'df', label: 'DF' },
  { key: 'first', label: '1st %' },
  { key: 'second', label: '2nd %' },
  { key: 'bps', label: 'BP S%' },
  { key: 'bpgu', label: 'BP GU' },
] as const;

export const ADV_AVG_ROWS = [
  { key: 'all', label: 'All' },
  { key: 'hard', label: 'Hard' },
  { key: 'clay', label: 'Clay' },
  { key: 'grass', label: 'Grass' },
  { key: 'righties', label: 'vs Righties' },
  { key: 'lefties', label: 'vs Lefties' },
  { key: 'h2h', label: 'H2H' },
] as const;

export const ADV_AVG_GLOSSARY = [
  { abbr: 'Match', meaning: 'Win-Loss record' },
  { abbr: 'DR', meaning: 'Dominance ratio (RPW% / serve points lost %)' },
  { abbr: 'Games', meaning: 'Games won / played' },
  { abbr: 'Hold %', meaning: 'Service games held' },
  { abbr: 'BP W%', meaning: 'Break points converted' },
  { abbr: 'BP GU', meaning: 'Breaks conceded per match' },
  { abbr: 'RPW%', meaning: 'Return points won' },
  { abbr: 'Aces', meaning: 'Aces per match' },
  { abbr: 'Ace All', meaning: 'Aces allowed per match' },
  { abbr: 'DF', meaning: 'Double faults per match' },
  { abbr: '1st %', meaning: 'First serve in' },
  { abbr: '2nd %', meaning: 'Second serve points won' },
  { abbr: 'BP S%', meaning: 'Break points saved' },
] as const;

export type AdvAvgWindow = (typeof ADV_AVG_WINDOWS)[number]['id'];
export type AdvAvgBestOf = (typeof ADV_AVG_BEST_OF)[number]['id'];
export type AdvAvgVsRank = (typeof ADV_AVG_VS_RANKS)[number]['id'];
export type AdvAvgRowKey = (typeof ADV_AVG_ROWS)[number]['key'];
export type AdvAvgColKey = (typeof ADV_AVG_COLUMNS)[number]['key'];
export type AdvAvgTone = 'good' | 'ok' | 'bad' | 'neutral' | 'empty';

export type AdvAvgCell = {
  text: string;
  tone: AdvAvgTone;
};

export type AdvAvgTableRow = {
  key: AdvAvgRowKey;
  label: string;
  matches: number;
  highlight: boolean;
  cells: Record<AdvAvgColKey, AdvAvgCell>;
};

export type AdvAvgSide = {
  name: string;
  hand: 'R' | 'L' | null;
  matches: number;
  rows: AdvAvgTableRow[];
};

export type TennisAdvancedAveragesPayload = {
  tour: 'ATP' | 'WTA';
  year: number;
  window: AdvAvgWindow;
  bestOf: AdvAvgBestOf;
  vsRank: AdvAvgVsRank;
  player: AdvAvgSide;
  opponent: AdvAvgSide | null;
  boards?: Partial<Record<string, { player: AdvAvgSide; opponent: AdvAvgSide | null }>>;
};

export function tennisAveragesBoardKey(
  window: AdvAvgWindow,
  bestOf: AdvAvgBestOf,
  vsRank: AdvAvgVsRank
): string {
  return `${window}|${bestOf}|${vsRank}`;
}
