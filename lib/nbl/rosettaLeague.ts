/**
 * NBL Rosetta league feeds: seasons, teams, ladder, schedule, team stats, leaders.
 */

import { fetchRosettaJson } from '@/lib/nbl/rosettaHttp';
import type {
  NblSeasonType,
  RosettaMatch,
  RosettaPlayerSeasonStats,
  RosettaSeason,
  RosettaStandingRow,
  RosettaTeam,
  RosettaTeamSeasonStats,
} from '@/lib/nbl/rosettaTypes';
import { nblSeasonLabel } from '@/lib/nblTeamCanonical';

export async function fetchNblSeasons(): Promise<RosettaSeason[] | null> {
  const res = await fetchRosettaJson<RosettaSeason[]>('nbl/seasons');
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

export async function fetchNblCurrentSeasons(limit = 20): Promise<RosettaSeason[] | null> {
  const res = await fetchRosettaJson<RosettaSeason[]>(`nbl/seasons/current?limit=${limit}`);
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

/** Prefer the main regular-season row named NBLxx for a start year. */
export async function resolveNblRegularSeason(
  year: number
): Promise<RosettaSeason | null> {
  const seasons = await fetchNblSeasons();
  if (!seasons) return null;
  const label = nblSeasonLabel(year);
  const exact = seasons.find(
    (s) =>
      String(s.year) === String(year) &&
      s.season_type === 'regular' &&
      String(s.name || '').toUpperCase() === label.toUpperCase()
  );
  if (exact) return exact;
  return (
    seasons.find(
      (s) => String(s.year) === String(year) && s.season_type === 'regular'
    ) ?? null
  );
}

export async function fetchNblTeams(): Promise<RosettaTeam[] | null> {
  const res = await fetchRosettaJson<RosettaTeam[]>('nbl/teams');
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

export async function fetchNblLadder(
  year: number,
  seasonType: NblSeasonType = 'regular'
): Promise<RosettaStandingRow[] | null> {
  const res = await fetchRosettaJson<RosettaStandingRow[]>(
    `nbl/standings/${year}/${seasonType}`
  );
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

export async function fetchNblSchedule(
  year: number,
  seasonType: NblSeasonType = 'regular'
): Promise<RosettaMatch[] | null> {
  const res = await fetchRosettaJson<RosettaMatch[]>(
    `nbl/matches/in/season/${year}/${seasonType}`
  );
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

export async function fetchNblNextMatches(year: number): Promise<RosettaMatch[] | null> {
  const res = await fetchRosettaJson<RosettaMatch[]>(
    `next/matches/for/teams/in/nbl/${year}`
  );
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

export async function fetchNblTeamStats(
  year: number,
  seasonType: NblSeasonType = 'regular'
): Promise<RosettaTeamSeasonStats[] | null> {
  const res = await fetchRosettaJson<RosettaTeamSeasonStats[]>(
    `nbl/team/stats/for/season/${year}/${seasonType}`
  );
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

export async function fetchNblStatLeaders(
  seasonId: string,
  options: { limit?: number; sort?: string } = {}
): Promise<RosettaPlayerSeasonStats[] | null> {
  const limit = Math.max(1, Number(options.limit ?? 100));
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  if (options.sort) params.set('sort', options.sort);
  const res = await fetchRosettaJson<RosettaPlayerSeasonStats[]>(
    `nbl/stats/leaders/for/season/id/${seasonId}?${params.toString()}`
  );
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}
