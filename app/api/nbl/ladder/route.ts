import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { fetchNblLadder } from '@/lib/nbl/rosettaLeague';
import { NBL_CURRENT_SEASON_YEAR, nblSeasonLabel } from '@/lib/nblTeamCanonical';

const TTL_MS = 1000 * 60 * 30;
const cache = new Map<number, { expiresAt: number; data: unknown }>();

function readSnapshot(year: number) {
  const file = path.join(process.cwd(), 'data', `nbl-ladder-${year}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const requested = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );
  const year = Number.isFinite(requested) ? requested : NBL_CURRENT_SEASON_YEAR;
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const live = request.nextUrl.searchParams.get('live') === '1';

  const cached = cache.get(year);
  if (!refresh && !live && cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  if (!live) {
    const snapshot = readSnapshot(year);
    if (snapshot?.teams?.length) {
      cache.set(year, { expiresAt: Date.now() + TTL_MS, data: snapshot });
      return NextResponse.json(snapshot);
    }
  }

  const rows = await fetchNblLadder(year, 'regular');
  if (!rows?.length) {
    return NextResponse.json(
      { error: 'NBL ladder unavailable', year, teams: [] },
      { status: 502 }
    );
  }

  const data = {
    year,
    seasonLabel: nblSeasonLabel(year),
    generatedAt: new Date().toISOString(),
    source: 'rosetta.nbl.com.au',
    teams: [...rows]
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
      })),
  };
  cache.set(year, { expiresAt: Date.now() + TTL_MS, data });
  return NextResponse.json(data);
}
