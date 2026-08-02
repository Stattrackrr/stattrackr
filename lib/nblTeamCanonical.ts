/**
 * Canonical NBL club mapping (current 10-team league).
 * Rosetta year = season START year (2025 = NBL26).
 */

export const NBL_CURRENT_SEASON_YEAR = 2026; // NBL27

/**
 * Shot chart + opp-def ranks: last completed season only (NBL27 hasn’t started).
 * Rosetta start year 2025 = NBL26.
 */
export const NBL_SHOT_CHART_SEASON_YEAR = 2025; // NBL26

/** Seasons loaded into the player chart (current → older). Rosetta start years. */
export const NBL_CHART_HISTORY_YEARS: readonly number[] = [2026, 2025, 2024, 2023];

export type NblClubCode =
  | 'ADL'
  | 'BRI'
  | 'CNS'
  | 'ILL'
  | 'MEL'
  | 'NZL'
  | 'PER'
  | 'SEM'
  | 'SYD'
  | 'TAS';

export const NBL_CLUBS: ReadonlyArray<{
  code: NblClubCode;
  name: string;
  shortName: string;
  id: string;
}> = [
  { code: 'ADL', name: 'Adelaide 36ers', shortName: '36ers', id: '3164912c-7e74-463b-8fc3-5f7d45edfcc6' },
  { code: 'BRI', name: 'Brisbane Bullets', shortName: 'Bullets', id: 'f8185bc5-2674-4293-a2a7-aeb8c7549b30' },
  { code: 'CNS', name: 'Cairns Taipans', shortName: 'Taipans', id: '6bf2a6e3-2626-491d-962b-48805205c06e' },
  { code: 'ILL', name: 'Illawarra Hawks', shortName: 'Hawks', id: '105249a3-251d-4a9d-94f4-f57b8e0854b3' },
  { code: 'MEL', name: 'Melbourne United', shortName: 'United', id: '41c8f340-4d0a-4d68-a3c7-1b31f643f803' },
  { code: 'NZL', name: 'New Zealand Breakers', shortName: 'Breakers', id: 'bbae77db-317d-4c17-aa04-75d53d20ad15' },
  { code: 'PER', name: 'Perth Wildcats', shortName: 'Wildcats', id: 'bc5327d5-322e-4796-b103-4c3b63869edb' },
  { code: 'SEM', name: 'South East Melbourne Phoenix', shortName: 'Phoenix', id: '3bdb8ad6-7cf0-464d-b62c-eaca9145d06e' },
  { code: 'SYD', name: 'Sydney Kings', shortName: 'Kings', id: '39fc4268-0cdf-455f-9ca1-12e344064000' },
  { code: 'TAS', name: 'Tasmania JackJumpers', shortName: 'JackJumpers', id: '0602b1bc-8dfb-488c-ac11-7895de1a7556' },
];

const CODE_TO_CLUB = new Map(NBL_CLUBS.map((c) => [c.code, c]));
const ID_TO_CLUB = new Map(NBL_CLUBS.map((c) => [c.id, c]));
const NAME_TO_CLUB = new Map(
  NBL_CLUBS.flatMap((c) => [
    [normalizeTeamKey(c.name), c],
    [normalizeTeamKey(c.shortName), c],
    [normalizeTeamKey(c.code), c],
  ])
);

export function normalizeTeamKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function getNblClubByCode(code: string | null | undefined) {
  if (!code) return null;
  return CODE_TO_CLUB.get(code.toUpperCase() as NblClubCode) ?? null;
}

export function getNblClubById(id: string | null | undefined) {
  if (!id) return null;
  return ID_TO_CLUB.get(id) ?? null;
}

export function resolveNblClubName(input: string | null | undefined): string | null {
  if (!input) return null;
  const direct = NAME_TO_CLUB.get(normalizeTeamKey(input));
  if (direct) return direct.name;
  const byCode = getNblClubByCode(input);
  if (byCode) return byCode.name;
  return String(input).trim() || null;
}

export function isCurrentNblClubId(teamId: string | null | undefined): boolean {
  return Boolean(teamId && ID_TO_CLUB.has(teamId));
}

/** Display label for Rosetta season year (2025 → NBL26). */
export function nblSeasonLabel(year: number | string): string {
  const y = Number(year);
  if (!Number.isFinite(y)) return `NBL${year}`;
  return `NBL${String(y + 1).slice(-2)}`;
}
