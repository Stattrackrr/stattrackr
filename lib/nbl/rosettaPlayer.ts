/**
 * NBL Rosetta player feeds: roster, season averages, game logs.
 */

import { fetchRosettaJson } from '@/lib/nbl/rosettaHttp';
import type {
  NblGameLogRow,
  NblLeaguePlayerStatRow,
  NblSeasonType,
  RosettaPlayerBoxScore,
  RosettaPlayerSeasonStats,
  RosettaRosterEntry,
} from '@/lib/nbl/rosettaTypes';

function toNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function playerDisplayName(entry: {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}): string {
  if (entry.full_name && String(entry.full_name).trim()) return String(entry.full_name).trim();
  return [entry.first_name, entry.last_name].filter(Boolean).join(' ').trim();
}

export async function fetchNblSeasonPlayers(year: number): Promise<RosettaRosterEntry[] | null> {
  const res = await fetchRosettaJson<RosettaRosterEntry[]>(`nbl/players/in/season/${year}`);
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

export async function fetchNblTeamRoster(
  teamId: string,
  year: number
): Promise<RosettaRosterEntry[] | null> {
  const res = await fetchRosettaJson<RosettaRosterEntry[]>(
    `nbl/players/for/team/${teamId}/in/season/${year}`
  );
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

export async function fetchNblPlayerSeasonStats(
  playerId: string
): Promise<RosettaPlayerSeasonStats[] | null> {
  const res = await fetchRosettaJson<RosettaPlayerSeasonStats[]>(
    `nbl/statistics/for/player/${playerId}`
  );
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

export async function fetchNblPlayerBoxscores(
  playerId: string,
  year: number,
  seasonType: NblSeasonType = 'regular'
): Promise<RosettaPlayerBoxScore[] | null> {
  const res = await fetchRosettaJson<RosettaPlayerBoxScore[]>(
    `nbl/player_boxscores/for/${playerId}/in/season/${year}/${seasonType}`
  );
  if (!res.ok) return null;
  return Array.isArray(res.data) ? res.data : null;
}

export function pickPlayerSeasonStatsForYear(
  rows: RosettaPlayerSeasonStats[] | null | undefined,
  year: number,
  seasonType: NblSeasonType = 'regular'
): RosettaPlayerSeasonStats | null {
  if (!rows?.length) return null;
  const match = rows.find(
    (r) =>
      String(r.season?.year) === String(year) &&
      (!seasonType || String(r.season?.season_type || 'regular') === seasonType)
  );
  return match ?? null;
}

export function normalizeLeaguePlayerStatRow(
  roster: RosettaRosterEntry,
  stats: RosettaPlayerSeasonStats | null
): NblLeaguePlayerStatRow {
  const player = roster.player;
  const name = playerDisplayName(player);
  const points = toNum(stats?.points_average);
  const rebounds = toNum(stats?.rebounds_average);
  const assists = toNum(stats?.assists_average);
  return {
    playerId: player.id,
    name,
    firstName: player.first_name ?? null,
    lastName: player.last_name ?? null,
    team: roster.team?.name ?? '',
    teamCode: roster.team?.team_code ?? null,
    teamId: roster.team?.id ?? null,
    position: roster.playing_position ?? player.playing_position ?? null,
    jersey:
      roster.jersey_number != null
        ? String(roster.jersey_number)
        : player.jersey_number != null
          ? String(player.jersey_number)
          : null,
    imageUrl: player.external_player_image ?? player.image ?? null,
    games: toNum(stats?.games) ?? 0,
    minutes: toNum(stats?.minutes_average),
    points,
    rebounds,
    assists,
    steals: toNum(stats?.steals_average),
    blocks: toNum(stats?.blocks_average),
    turnovers: toNum(stats?.turnovers_average),
    fouls: toNum(stats?.fouls_average),
    fgPct: toNum(stats?.field_goals_percentage),
    threePct: toNum(stats?.three_points_percentage),
    ftPct: toNum(stats?.free_throws_percentage),
    threeMade: toNum(stats?.three_points_made_average),
    pra:
      points != null && rebounds != null && assists != null
        ? Number((points + rebounds + assists).toFixed(2))
        : null,
  };
}

export function normalizePlayerBoxScore(
  row: RosettaPlayerBoxScore,
  seasonYear: number
): NblGameLogRow | null {
  const match = row.match;
  if (!match?.id) return null;
  const teamId = row.team?.id ?? null;
  const homeId = match.home_team?.id ?? null;
  const awayId = match.away_team?.id ?? null;
  const isHome = Boolean(teamId && homeId && teamId === homeId);
  const opponentTeam = isHome ? match.away_team : match.home_team;
  const points = toNum(row.points);
  const rebounds = toNum(row.rebounds);
  const assists = toNum(row.assists);

  const homeScore = toNum(match.home_score);
  const awayScore = toNum(match.away_score);
  let result: string | null = null;
  if (homeScore != null && awayScore != null) {
    const teamScore = isHome ? homeScore : awayScore;
    const oppScore = isHome ? awayScore : homeScore;
    const won = teamScore > oppScore;
    // Compatible with AFL getGameOutcome (checks win/w and loss/l)
    result = won
      ? `W ${teamScore}-${oppScore}`
      : teamScore < oppScore
        ? `L ${teamScore}-${oppScore}`
        : `T ${teamScore}-${oppScore}`;
  }

  const venue =
    match.venue && typeof match.venue.name === 'string' && match.venue.name.trim()
      ? match.venue.name.trim()
      : null;

  return {
    matchId: match.id,
    date: match.start_time_datetime ?? null,
    season: seasonYear,
    round: null,
    opponent: opponentTeam?.name ?? '—',
    opponentCode: opponentTeam?.team_code ?? null,
    isHome,
    team: row.team?.name ?? '',
    teamCode: row.team?.team_code ?? null,
    result,
    venue,
    minutes: toNum(row.minutes),
    points,
    rebounds,
    offensiveRebounds: toNum(row.offensive_rebounds),
    defensiveRebounds: toNum(row.defensive_rebounds),
    assists,
    steals: toNum(row.steals),
    blocks: toNum(row.blocks),
    turnovers: toNum(row.turnovers),
    fouls: toNum(row.personal_fouls ?? row.fouls),
    fgMade: toNum(row.field_goals_made),
    fgAttempted: toNum(row.field_goals_attempted),
    fgPct: toNum(row.field_goals_percentage),
    twoMade: toNum(row.two_points_made),
    twoAttempted: toNum(row.two_points_attempted),
    twoPct: toNum(row.two_points_percentage),
    threeMade: toNum(row.three_points_made),
    threeAttempted: toNum(row.three_points_attempted),
    threePct: toNum(row.three_points_percentage),
    ftMade: toNum(row.free_throws_made),
    ftAttempted: toNum(row.free_throws_attempted),
    ftPct: toNum(row.free_throws_percentage),
    plusMinus: toNum(row.plus_minus),
    efficiency: toNum(row.efficiency),
    pra:
      points != null && rebounds != null && assists != null
        ? points + rebounds + assists
        : null,
    pr: points != null && rebounds != null ? points + rebounds : null,
    pa: points != null && assists != null ? points + assists : null,
    ra: rebounds != null && assists != null ? rebounds + assists : null,
  };
}

export async function fetchNormalizedPlayerGameLogs(
  playerId: string,
  year: number,
  seasonType: NblSeasonType = 'regular'
): Promise<NblGameLogRow[]> {
  const boxes = await fetchNblPlayerBoxscores(playerId, year, seasonType);
  if (!boxes?.length) return [];
  return boxes
    .map((b) => normalizePlayerBoxScore(b, year))
    .filter((r): r is NblGameLogRow => Boolean(r))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}
