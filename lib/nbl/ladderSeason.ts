/**
 * Which NBL ladder to cache/show: last completed season until the current
 * season (NBL27 / 2026) has a finished game, then auto-swap.
 */

import fs from 'fs';
import path from 'path';
import { NBL_CURRENT_SEASON_YEAR, nblSeasonLabel } from '@/lib/nblTeamCanonical';
import type { RosettaStandingRow } from '@/lib/nbl/rosettaTypes';

export type NblLadderTeamRow = {
  pos: number | null;
  team: string;
  teamCode: string | null;
  teamId: string | null;
  teamLogo: string | null;
  played: number;
  win: number;
  loss: number;
  points_for: number | null;
  points_against: number | null;
  points_percentage: number | null;
  win_percentage: number | null;
  last_5: string | null;
  streak: number | null;
  home_wins?: number | null;
  home_losses?: number | null;
  away_wins?: number | null;
  away_losses?: number | null;
};

export type NblLadderSnapshot = {
  year: number;
  seasonLabel: string;
  generatedAt: string;
  source: string;
  teams: NblLadderTeamRow[];
};

export function nblLastCompletedSeasonYear(): number {
  return NBL_CURRENT_SEASON_YEAR - 1;
}

function currentSeasonHasCompletedGames(year: number): boolean {
  const file = path.join(process.cwd(), 'data', `nbl-schedule-${year}.json`);
  if (!fs.existsSync(file)) return false;
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      games?: Array<{ status?: string | null; homeScore?: number | null; awayScore?: number | null }>;
    };
    const games = Array.isArray(json.games) ? json.games : [];
    return games.some((game) => {
      const home = Number(game.homeScore);
      const away = Number(game.awayScore);
      if (!Number.isFinite(home) || !Number.isFinite(away)) return false;
      const status = String(game.status || '').toLowerCase();
      if (status === 'scheduled' || status === 'upcoming') return false;
      return true;
    });
  } catch {
    return false;
  }
}

/** Last completed season until the current season has a finished game. */
export function resolveNblLadderYear(): number {
  if (currentSeasonHasCompletedGames(NBL_CURRENT_SEASON_YEAR)) {
    return NBL_CURRENT_SEASON_YEAR;
  }
  return nblLastCompletedSeasonYear();
}

export function nblLadderSnapshotPath(year: number): string {
  return path.join(process.cwd(), 'data', `nbl-ladder-${year}.json`);
}

export function nblLadderHasPlayedGames(teams: NblLadderTeamRow[] | undefined): boolean {
  return Array.isArray(teams) && teams.some((row) => Number(row.played) > 0);
}

export function readNblLadderSnapshot(year: number): NblLadderSnapshot | null {
  const file = nblLadderSnapshotPath(year);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as NblLadderSnapshot;
  } catch {
    return null;
  }
}

export function mapNblLadderRows(rows: RosettaStandingRow[]): NblLadderTeamRow[] {
  return [...rows]
    .sort((a, b) => Number(a.position) - Number(b.position))
    .map((row) => ({
      pos: Number(row.position) || null,
      team: row.team?.name ?? '',
      teamCode: row.team?.team_code ?? null,
      teamId: row.team?.id ?? null,
      teamLogo: row.team?.team_logo ?? row.team?.external_team_logo ?? null,
      played: Number(row.played) || 0,
      win: Number(row.won) || 0,
      loss: Number(row.lost) || 0,
      points_for: row.points_for ?? null,
      points_against: row.points_against ?? null,
      points_percentage: row.points_percentage ?? null,
      win_percentage: row.win_percentage ?? null,
      last_5: row.last_5 ?? null,
      streak: row.streak ?? null,
      home_wins: row.home_wins ?? null,
      home_losses: row.home_losses ?? null,
      away_wins: row.away_wins ?? null,
      away_losses: row.away_losses ?? null,
    }));
}

export function writeNblLadderSnapshot(year: number, teams: NblLadderTeamRow[]): NblLadderSnapshot {
  const data: NblLadderSnapshot = {
    year,
    seasonLabel: nblSeasonLabel(year),
    generatedAt: new Date().toISOString(),
    source: 'rosetta.nbl.com.au',
    teams,
  };
  fs.writeFileSync(nblLadderSnapshotPath(year), JSON.stringify(data, null, 2));
  return data;
}
