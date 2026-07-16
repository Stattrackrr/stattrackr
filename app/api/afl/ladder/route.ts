import { NextRequest, NextResponse } from 'next/server';
import { fetchFootyinfoLadder } from '@/lib/afl/footyinfoLeague';

const TTL_MS = 1000 * 60 * 30;

export type LadderRow = {
  pos: number;
  team: string;
  played: number;
  win: number;
  loss: number;
  draw: number;
  points_for: number | null;
  points_against: number | null;
  percentage: number | null;
  premiership_points: number | null;
};

const cache = new Map<number, { expiresAt: number; data: { season: number; teams: LadderRow[] } }>();

const numberOrNull = (value: string | undefined): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get('season') || process.env.AFL_CURRENT_SEASON || new Date().getFullYear());
  const season = Number.isFinite(requested) ? requested : new Date().getFullYear();
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const cached = cache.get(season);
  if (!refresh && cached && cached.expiresAt > Date.now()) return NextResponse.json(cached.data);

  const ladder = await fetchFootyinfoLadder(season);
  if (!ladder) return NextResponse.json({ error: 'FootyInfo ladder unavailable', season, teams: [] }, { status: 502 });

  const data = {
    season: ladder.seasonYear,
    teams: ladder.teams.map((team, index) => ({
      pos: index + 1,
      team: team.tm,
      played: Number(team.p) || 0,
      win: Number(team.w) || 0,
      loss: Number(team.l) || 0,
      draw: Number(team.d) || 0,
      points_for: numberOrNull(team.f),
      points_against: numberOrNull(team.a),
      percentage: numberOrNull(team.pct),
      premiership_points: numberOrNull(team.pts),
    })),
  };
  cache.set(season, { expiresAt: Date.now() + TTL_MS, data });
  return NextResponse.json(data);
}
