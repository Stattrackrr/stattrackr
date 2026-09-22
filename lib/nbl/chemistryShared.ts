/**
 * Client-safe NBL court-chemistry types (no Node / disk cache imports).
 */

export type NblChemistryTab = 'linkups' | 'oncourt';
export type NblChemistryMetric = 'points' | 'rebounds' | 'assists';

export const NBL_CHEM_METRICS: readonly NblChemistryMetric[] = ['points', 'rebounds', 'assists'];

export const NBL_CHEM_METRIC_LABELS: Record<NblChemistryMetric, string> = {
  points: 'Scoring',
  rebounds: 'Boards',
  assists: 'Assists',
};

/** Skip on/off rows unless they reach this shared time. */
export const NBL_CHEM_MIN_SHARED_MINUTES = 8;
/** Alternate floor: ~80 shared possessions. */
export const NBL_CHEM_MIN_SHARED_POSSESSIONS = 80;
/** Need a without-sample so lift is defined. */
export const NBL_CHEM_MIN_OFF_MINUTES = 3;

export type NblChemistryLinkupRow = {
  name: string;
  personId: string | null;
  count: number;
  pts: number;
  share: number;
};

export type NblChemistryOnCourtRow = {
  name: string;
  personId: string | null;
  onPer36: number;
  offPer36: number;
  liftPct: number | null;
  onMinutes: number;
  offMinutes: number;
  onPossessions: number;
};

export type NblChemistryPayload = {
  success: boolean;
  empty?: boolean;
  message?: string | null;
  playerName: string;
  team: string | null;
  seasonYear: number;
  gamesUsed: number;
  gamesWithOnOff: number;
  madeFg: number;
  assistedMakes: number;
  unassistedMakes: number;
  unassistedMakePct: number | null;
  assists: number;
  heFinds: NblChemistryLinkupRow[];
  findsHim: NblChemistryLinkupRow[];
  onCourt: Record<NblChemistryMetric, NblChemistryOnCourtRow[]>;
};

export function nblChemistryTabForStat(stat: string | null | undefined): NblChemistryTab {
  const s = String(stat || '').toLowerCase();
  if (s === 'assists' || s === 'ast' || /(?:^|_)ast$/.test(s)) return 'linkups';
  return 'oncourt';
}

export function nblChemistryMetricForStat(stat: string | null | undefined): NblChemistryMetric {
  const s = String(stat || '').toLowerCase();
  if (s === 'rebounds' || s === 'reb' || /(?:^|_)reb$/.test(s)) return 'rebounds';
  if (s === 'assists' || s === 'ast' || /(?:^|_)ast$/.test(s)) return 'assists';
  return 'points';
}

export function emptyNblChemistryPayload(
  playerName: string,
  seasonYear: number,
  message: string
): NblChemistryPayload {
  return {
    success: true,
    empty: true,
    message,
    playerName,
    team: null,
    seasonYear,
    gamesUsed: 0,
    gamesWithOnOff: 0,
    madeFg: 0,
    assistedMakes: 0,
    unassistedMakes: 0,
    unassistedMakePct: null,
    assists: 0,
    heFinds: [],
    findsHim: [],
    onCourt: { points: [], rebounds: [], assists: [] },
  };
}
