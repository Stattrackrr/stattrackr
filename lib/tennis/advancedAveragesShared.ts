export const ADV_AVG_WINDOWS = [
  { id: 5, label: 'Last 5' },
  { id: 10, label: 'Last 10' },
  { id: 15, label: 'Last 15' },
  { id: 20, label: 'Last 20' },
  { id: 0, label: 'Season' },
] as const;

export const ADV_AVG_BEST_OF = [
  { id: 'all', label: 'Best Of' },
  { id: '3', label: 'BO3' },
  { id: '5', label: 'BO5' },
] as const;

export const ADV_AVG_VS_RANKS = [
  { id: 'all', label: 'VS Rank' },
  { id: '10', label: 'Top 10' },
  { id: '20', label: 'Top 20' },
  { id: '50', label: 'Top 50' },
  { id: '100', label: 'Top 100' },
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
};
