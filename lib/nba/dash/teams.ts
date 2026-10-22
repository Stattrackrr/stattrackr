/**
 * Canonical NBA franchises for the NBA dashboard (client-safe).
 * Season year = season START year (2025 = 2025-26), same as BallDontLie.
 */

import { getEspnLogoUrl } from '@/app/nba/research/dashboard/utils/teamUtils';

export const NBA_CURRENT_SEASON_YEAR = 2026; // 2026-27

/** Shot charts show the current season only. */
export const NBA_SHOT_CHART_SEASON_YEAR = 2026;
export const NBA_SHOT_CHART_CACHE_YEARS: readonly number[] = [NBA_SHOT_CHART_SEASON_YEAR];

/** Seasons loaded into the player chart (current → older). */
export const NBA_CHART_HISTORY_YEARS: readonly number[] = [2026, 2025, 2024, 2023];

export type NbaClubCode =
  | 'ATL' | 'BOS' | 'BKN' | 'CHA' | 'CHI' | 'CLE' | 'DAL' | 'DEN' | 'DET' | 'GSW'
  | 'HOU' | 'IND' | 'LAC' | 'LAL' | 'MEM' | 'MIA' | 'MIL' | 'MIN' | 'NOP' | 'NYK'
  | 'OKC' | 'ORL' | 'PHI' | 'PHX' | 'POR' | 'SAC' | 'SAS' | 'TOR' | 'UTA' | 'WAS';

/** id = BallDontLie team id. */
export const NBA_CLUBS: ReadonlyArray<{
  code: NbaClubCode;
  name: string;
  shortName: string;
  city: string;
  id: string;
}> = [
  { code: 'ATL', name: 'Atlanta Hawks', shortName: 'Hawks', city: 'Atlanta', id: '1' },
  { code: 'BOS', name: 'Boston Celtics', shortName: 'Celtics', city: 'Boston', id: '2' },
  { code: 'BKN', name: 'Brooklyn Nets', shortName: 'Nets', city: 'Brooklyn', id: '3' },
  { code: 'CHA', name: 'Charlotte Hornets', shortName: 'Hornets', city: 'Charlotte', id: '4' },
  { code: 'CHI', name: 'Chicago Bulls', shortName: 'Bulls', city: 'Chicago', id: '5' },
  { code: 'CLE', name: 'Cleveland Cavaliers', shortName: 'Cavaliers', city: 'Cleveland', id: '6' },
  { code: 'DAL', name: 'Dallas Mavericks', shortName: 'Mavericks', city: 'Dallas', id: '7' },
  { code: 'DEN', name: 'Denver Nuggets', shortName: 'Nuggets', city: 'Denver', id: '8' },
  { code: 'DET', name: 'Detroit Pistons', shortName: 'Pistons', city: 'Detroit', id: '9' },
  { code: 'GSW', name: 'Golden State Warriors', shortName: 'Warriors', city: 'Golden State', id: '10' },
  { code: 'HOU', name: 'Houston Rockets', shortName: 'Rockets', city: 'Houston', id: '11' },
  { code: 'IND', name: 'Indiana Pacers', shortName: 'Pacers', city: 'Indiana', id: '12' },
  { code: 'LAC', name: 'LA Clippers', shortName: 'Clippers', city: 'LA', id: '13' },
  { code: 'LAL', name: 'Los Angeles Lakers', shortName: 'Lakers', city: 'Los Angeles', id: '14' },
  { code: 'MEM', name: 'Memphis Grizzlies', shortName: 'Grizzlies', city: 'Memphis', id: '15' },
  { code: 'MIA', name: 'Miami Heat', shortName: 'Heat', city: 'Miami', id: '16' },
  { code: 'MIL', name: 'Milwaukee Bucks', shortName: 'Bucks', city: 'Milwaukee', id: '17' },
  { code: 'MIN', name: 'Minnesota Timberwolves', shortName: 'Timberwolves', city: 'Minnesota', id: '18' },
  { code: 'NOP', name: 'New Orleans Pelicans', shortName: 'Pelicans', city: 'New Orleans', id: '19' },
  { code: 'NYK', name: 'New York Knicks', shortName: 'Knicks', city: 'New York', id: '20' },
  { code: 'OKC', name: 'Oklahoma City Thunder', shortName: 'Thunder', city: 'Oklahoma City', id: '21' },
  { code: 'ORL', name: 'Orlando Magic', shortName: 'Magic', city: 'Orlando', id: '22' },
  { code: 'PHI', name: 'Philadelphia 76ers', shortName: '76ers', city: 'Philadelphia', id: '23' },
  { code: 'PHX', name: 'Phoenix Suns', shortName: 'Suns', city: 'Phoenix', id: '24' },
  { code: 'POR', name: 'Portland Trail Blazers', shortName: 'Trail Blazers', city: 'Portland', id: '25' },
  { code: 'SAC', name: 'Sacramento Kings', shortName: 'Kings', city: 'Sacramento', id: '26' },
  { code: 'SAS', name: 'San Antonio Spurs', shortName: 'Spurs', city: 'San Antonio', id: '27' },
  { code: 'TOR', name: 'Toronto Raptors', shortName: 'Raptors', city: 'Toronto', id: '28' },
  { code: 'UTA', name: 'Utah Jazz', shortName: 'Jazz', city: 'Utah', id: '29' },
  { code: 'WAS', name: 'Washington Wizards', shortName: 'Wizards', city: 'Washington', id: '30' },
];

export type NbaConference = 'East' | 'West';

const EAST: ReadonlySet<NbaClubCode> = new Set<NbaClubCode>([
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NYK', 'ORL', 'PHI', 'TOR', 'WAS',
]);

export function nbaConference(code: string | null | undefined): NbaConference | null {
  const club = code ? CODE_TO_CLUB.get(code.toUpperCase() as NbaClubCode) : undefined;
  if (!club) return null;
  return EAST.has(club.code) ? 'East' : 'West';
}

const CODE_TO_CLUB = new Map(NBA_CLUBS.map((c) => [c.code, c]));
const ID_TO_CLUB = new Map(NBA_CLUBS.map((c) => [c.id, c]));

/** Book / feed spellings that don't collapse to name, nickname or code. */
const EXTRA_NAME_ALIASES: ReadonlyArray<[string, NbaClubCode]> = [
  ['Los Angeles Clippers', 'LAC'],
  ['L.A. Clippers', 'LAC'],
  ['LA Lakers', 'LAL'],
  ['L.A. Lakers', 'LAL'],
  ['Sixers', 'PHI'],
  ['Philadelphia Sixers', 'PHI'],
  ['Blazers', 'POR'],
  ['Portland Blazers', 'POR'],
  ['Cavs', 'CLE'],
  ['Mavs', 'DAL'],
  ['Wolves', 'MIN'],
  ['Pels', 'NOP'],
  ['Okla City Thunder', 'OKC'],
  ['GS Warriors', 'GSW'],
  ['NO Pelicans', 'NOP'],
  ['NY Knicks', 'NYK'],
  ['SA Spurs', 'SAS'],
  ['BRK', 'BKN'],
  ['BKN Nets', 'BKN'],
  ['CHO', 'CHA'],
  ['PHO', 'PHX'],
  ['GS', 'GSW'],
  ['NO', 'NOP'],
  ['NY', 'NYK'],
  ['SA', 'SAS'],
  ['UTAH', 'UTA'],
  ['WSH', 'WAS'],
];

export function normalizeTeamKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

const NAME_TO_CLUB = new Map(
  NBA_CLUBS.flatMap((c) => [
    [normalizeTeamKey(c.name), c],
    [normalizeTeamKey(c.shortName), c],
    [normalizeTeamKey(c.code), c],
  ])
);

for (const [alias, code] of EXTRA_NAME_ALIASES) {
  const club = CODE_TO_CLUB.get(code);
  if (club) NAME_TO_CLUB.set(normalizeTeamKey(alias), club);
}

export function getNbaClubByCode(code: string | null | undefined) {
  if (!code) return null;
  return CODE_TO_CLUB.get(code.toUpperCase() as NbaClubCode) ?? NAME_TO_CLUB.get(normalizeTeamKey(code)) ?? null;
}

export function getNbaClubById(id: string | number | null | undefined) {
  if (id == null || id === '') return null;
  return ID_TO_CLUB.get(String(id)) ?? null;
}

export function resolveNbaClub(input: string | null | undefined) {
  if (!input) return null;
  return NAME_TO_CLUB.get(normalizeTeamKey(input)) ?? null;
}

export function resolveNbaClubName(input: string | null | undefined): string | null {
  if (!input) return null;
  const club = resolveNbaClub(input);
  if (club) return club.name;
  return String(input).trim() || null;
}

/** Official franchise only. `resolveNbaClubName` still returns unmatched raw labels. */
export function officialNbaClubName(input: string | null | undefined): string | null {
  return resolveNbaClub(input)?.name ?? null;
}

export function isCurrentNbaClubId(teamId: string | null | undefined): boolean {
  return Boolean(teamId && ID_TO_CLUB.has(String(teamId)));
}

export function nbaTeamCode(input: string | null | undefined): string {
  const club = resolveNbaClub(input);
  return club?.code ?? String(input || '').slice(0, 3).toUpperCase();
}

export function nbaTeamLogoUrl(input: string | null | undefined): string | null {
  const club = resolveNbaClub(input);
  return club ? getEspnLogoUrl(club.code) : null;
}

/** Display label for a season start year (2025 → 2025/26). */
export function nbaSeasonLabel(year: number | string): string {
  const y = Number(year);
  if (!Number.isFinite(y)) return String(year);
  return `${y}/${String(y + 1).slice(-2)}`;
}
