/**
 * NBA Team Division Mapping
 * Used for Division Rival model
 */

export const TEAM_TO_DIVISION: Record<string, string> = {
  ATL: 'Southeast',
  BOS: 'Atlantic',
  BKN: 'Atlantic',
  CHA: 'Southeast',
  CHI: 'Central',
  CLE: 'Central',
  DAL: 'Southwest',
  DEN: 'Northwest',
  DET: 'Central',
  GSW: 'Pacific',
  HOU: 'Southwest',
  IND: 'Central',
  LAC: 'Pacific',
  LAL: 'Pacific',
  MEM: 'Southwest',
  MIA: 'Southeast',
  MIL: 'Central',
  MIN: 'Northwest',
  NOP: 'Southwest',
  NYK: 'Atlantic',
  OKC: 'Northwest',
  ORL: 'Southeast',
  PHI: 'Atlantic',
  PHX: 'Pacific',
  POR: 'Northwest',
  SAC: 'Pacific',
  SAS: 'Southwest',
  TOR: 'Atlantic',
  UTA: 'Northwest',
  WAS: 'Southeast',
};

export function isDivisionRival(playerTeam: string, opponentTeam: string): boolean {
  const playerDiv = TEAM_TO_DIVISION[playerTeam?.toUpperCase?.() || ''];
  const oppDiv = TEAM_TO_DIVISION[opponentTeam?.toUpperCase?.() || ''];
  if (!playerDiv || !oppDiv) return false;
  return playerDiv === oppDiv;
}
