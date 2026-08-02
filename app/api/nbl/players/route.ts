import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  NBL_CHART_HISTORY_YEARS,
  NBL_CURRENT_SEASON_YEAR,
  nblSeasonLabel,
} from '@/lib/nblTeamCanonical';

type RosterPlayer = {
  playerId?: string | null;
  name: string;
  team?: string | null;
  teamCode?: string | null;
  teamId?: string | null;
  position?: string | null;
  jersey?: string | null;
  imageUrl?: string | null;
  sourceYear?: number;
  [key: string]: unknown;
};

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function normalizeNameKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function playerKey(p: RosterPlayer): string {
  if (p.playerId) return `id:${p.playerId}`;
  return `name:${normalizeNameKey(p.name)}`;
}

/**
 * Search roster for a season.
 * Default: merge current + chart-history years so prior-season players
 * (e.g. Quentin Peterson) remain searchable even if missing from the NBL27 tracker.
 * Pass `currentOnly=1` for tracker/current-year roster only.
 */
export async function GET(request: NextRequest) {
  const requested = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );
  const year = Number.isFinite(requested) ? requested : NBL_CURRENT_SEASON_YEAR;
  const byTeam = ['1', 'true'].includes(
    String(request.nextUrl.searchParams.get('byTeam') || '').toLowerCase()
  );
  const currentOnly = ['1', 'true'].includes(
    String(request.nextUrl.searchParams.get('currentOnly') || '').toLowerCase()
  );

  if (byTeam) {
    const file = path.join(process.cwd(), 'data', `nbl-rosters-by-team-${year}.json`);
    if (!fs.existsSync(file)) {
      return NextResponse.json(
        {
          error: `Roster for ${year} not found. Run: npm run fetch:nbl:roster:nbl27`,
        },
        { status: 404 }
      );
    }
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return NextResponse.json(data);
    } catch {
      return NextResponse.json({ error: 'Corrupt roster snapshot' }, { status: 503 });
    }
  }

  const years = currentOnly
    ? [year]
    : [...new Set([year, ...NBL_CHART_HISTORY_YEARS])].sort((a, b) => b - a);

  const byKey = new Map<string, RosterPlayer>();
  const yearsLoaded: number[] = [];

  for (const y of years) {
    const rosterPath = path.join(process.cwd(), 'data', `nbl-roster-${y}.json`);
    const statsPath = path.join(process.cwd(), 'data', `nbl-league-player-stats-${y}.json`);
    const roster = readJson<{ players?: RosterPlayer[] }>(rosterPath);
    const stats = readJson<{ players?: RosterPlayer[] }>(statsPath);
    const rows = [
      ...(Array.isArray(roster?.players) ? roster!.players! : []),
      ...(Array.isArray(stats?.players) ? stats!.players! : []),
    ];
    if (!rows.length) continue;
    yearsLoaded.push(y);

    for (const raw of rows) {
      if (!raw?.name) continue;
      const player: RosterPlayer = {
        playerId: raw.playerId ?? null,
        name: raw.name,
        team: raw.team ?? null,
        teamCode: raw.teamCode ?? null,
        teamId: raw.teamId ?? null,
        position: raw.position ?? null,
        jersey: raw.jersey != null ? String(raw.jersey) : null,
        imageUrl: raw.imageUrl ?? null,
        sourceYear: y,
      };
      const key = playerKey(player);
      const existing = byKey.get(key);
      // Prefer newer season; fill missing fields from older rows.
      if (!existing) {
        byKey.set(key, player);
        continue;
      }
      if ((existing.sourceYear ?? 0) < y) {
        byKey.set(key, {
          ...player,
          position: player.position || existing.position,
          jersey: player.jersey || existing.jersey,
          imageUrl: player.imageUrl || existing.imageUrl,
          playerId: player.playerId || existing.playerId,
        });
      } else {
        byKey.set(key, {
          ...existing,
          position: existing.position || player.position,
          jersey: existing.jersey || player.jersey,
          imageUrl: existing.imageUrl || player.imageUrl,
          playerId: existing.playerId || player.playerId,
        });
      }
    }
  }

  const players = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));

  if (!players.length) {
    return NextResponse.json(
      {
        error: `Roster for ${year} not found. Run: npm run fetch:nbl:roster:nbl27`,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    year,
    seasonLabel: nblSeasonLabel(year),
    generatedAt: new Date().toISOString(),
    source: currentOnly ? 'current-roster' : 'merged-roster-history',
    yearsLoaded,
    playerCount: players.length,
    players,
  });
}
